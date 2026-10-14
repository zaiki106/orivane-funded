"""Transparent Windows compatibility build of upstream Qlib0.9.8.

No compiler is bundled. Reuse official0.9.7native binaries ONLY after verifying
every native source is byte-identical to upstream0.9.8. Python source is0.9.8.
The resulting local version is0.9.8+orivane.1, never described as an upstreamwheel.
"""
from __future__ import annotations

import base64
import csv
import hashlib
import io
import json
import platform
import subprocess
import sys
import tomllib
import zipfile
from pathlib import Path

from .download import curl, sha256
from .storage import DEFAULT_ROOT, atomic_json, initialize, require_capacity, utc_now

REVISION = "54355232463878d2eebb91fe0ee5fa7fa1f5976c"
SOURCE_URL = f"https://github.com/microsoft/qlib/archive/{REVISION}.zip"
SOURCE_SHA256 = "9d6b630fbd6d17dce919067d21497093c7ab41ba5d743fa4e9066815d5cc42a4"
NATIVE_WHEEL_SHA256 = "dfbee9f0f3005fe805798e2a21c73b198272f1341d5f0d7771e127166faac08e"
BASE_REVISION = "da920b7f954f48ab1bb64117c976710de198373e"
BASE_SOURCE_URL = f"https://github.com/microsoft/qlib/archive/{BASE_REVISION}.zip"
VERSION = "0.9.8+orivane.1"


def build(root=DEFAULT_ROOT):
    if sys.version_info[:2] != (3, 12) or platform.system() != "Windows" or platform.machine().lower() not in ("amd64", "x86_64"):
        raise RuntimeError("This compatibility build is for WindowsAMD64 Python3.12only")
    root = initialize(root)
    folder = root / "raw/components/qlib"
    folder.mkdir(parents=True, exist_ok=True)
    require_capacity(root, 50_000_000)
    source_path, base_path = folder / "source-0.9.8.zip", folder / "source-0.9.7.zip"
    for url, destination in ((SOURCE_URL, source_path), (BASE_SOURCE_URL, base_path)):
        if not destination.exists():
            curl("--max-time", "120", "--output", str(destination), url)
    if sha256(source_path) != SOURCE_SHA256:
        raise ValueError("Pinned upstream0.9.8source archive checksum mismatch")
    release = json.loads(curl("--max-time", "60", "https://pypi.org/pypi/pyqlib/0.9.7/json").stdout)
    artifact = next(row for row in release["urls"] if row["filename"] == "pyqlib-0.9.7-cp312-cp312-win_amd64.whl")
    wheel_path = folder / artifact["filename"]
    if not wheel_path.exists():
        curl("--max-time", "120", "--output", str(wheel_path), artifact["url"])
    if sha256(wheel_path) != artifact["digests"]["sha256"] or sha256(wheel_path) != NATIVE_WHEEL_SHA256:
        raise ValueError("Official PyPI wheel checksum mismatch")

    def members(path):
        with zipfile.ZipFile(path) as archive:
            prefix = archive.namelist()[0].split("/")[0] + "/"
            return {name[len(prefix):]: archive.read(name) for name in archive.namelist() if not name.endswith("/")}

    source, base = members(source_path), members(base_path)
    native = {name: payload for name, payload in source.items() if name.startswith("qlib/data/_libs/") and Path(name).suffix in (".pyx", ".pxd", ".pxi", ".h", ".hpp")}
    base_native = {name: payload for name, payload in base.items() if name.startswith("qlib/data/_libs/") and Path(name).suffix in (".pyx", ".pxd", ".pxi", ".h", ".hpp")}
    if not native or native != base_native:
        raise ValueError("Native code differs; compiler required, compatibility build refused")
    project = tomllib.loads(source["pyproject.toml"].decode())["project"]
    with zipfile.ZipFile(wheel_path) as archive:
        binaries = {name: archive.read(name) for name in archive.namelist() if name.startswith("qlib/") and name.endswith(".pyd")}
    if set(Path(name).name.split(".")[0] for name in binaries) != {"rolling", "expanding"}:
        raise ValueError("Unexpected native binary set")
    files = {name: payload for name, payload in source.items() if name.startswith("qlib/")}
    files.update(binaries)
    files["qlib/_version.py"] = f"version = '{VERSION}'\n__version__ = version\n".encode()
    information = f"pyqlib-{VERSION}.dist-info"
    license_text = source.get("LICENSE", source.get("LICENSE.txt"))
    if not license_text:
        raise ValueError("Upstream MIT license missing")
    files[information + "/LICENSE"] = license_text
    files[information + "/METADATA"] = (f"Metadata-Version: 2.3\nName: pyqlib\nVersion: {VERSION}\nSummary: UpstreamQlib0.9.8Windowscompatibilitybuild\nLicense: MIT\nRequires-Python: >=3.12\n" +
        "".join(f"Requires-Dist: {requirement}\n" for requirement in project["dependencies"]) + "\n" +
        f"Python source revision:{REVISION}; nativebinaries fromofficial0.9.7wheelafterbyte-identicalsourceaudit.\n").encode()
    files[information + "/WHEEL"] = b"Wheel-Version: 1.0\nGenerator: Orivane-audited-native-compat\nRoot-Is-Purelib: false\nTag: cp312-cp312-win_amd64\n"
    files[information + "/entry_points.txt"] = b"[console_scripts]\nqrun = qlib.cli.run:run\n"
    records = io.StringIO()
    writer = csv.writer(records, lineterminator="\n")
    for name, payload in sorted(files.items()):
        digest = base64.urlsafe_b64encode(hashlib.sha256(payload).digest()).decode().rstrip("=")
        writer.writerow([name, "sha256=" + digest, len(payload)])
    writer.writerow([information + "/RECORD", "", ""])
    files[information + "/RECORD"] = records.getvalue().encode()
    output = folder / f"pyqlib-{VERSION}-cp312-cp312-win_amd64.whl"
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, payload in sorted(files.items()):
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, payload, compresslevel=9)
    provenance = {"version": VERSION, "upstreamVersion": "0.9.8", "upstreamRevision": REVISION, "sourceUrl": SOURCE_URL,
        "sourceSha256": sha256(source_path), "nativeBaseVersion": "0.9.7", "nativeBaseRevision": BASE_REVISION, "nativeWheelUrl": artifact["url"],
        "nativeWheelSha256": sha256(wheel_path), "identicalNativeSources": {name: hashlib.sha256(payload).hexdigest() for name, payload in native.items()},
        "binarySha256": {name: hashlib.sha256(payload).hexdigest() for name, payload in binaries.items()},
        "adaptedWheelSha256": sha256(output), "createdAt": utc_now(), "license": "MIT", "private": True}
    atomic_json(root / "registry/qlib-compatibility.json", provenance)
    return output, provenance


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--install", action="store_true")
    args = parser.parse_args()
    output, provenance = build(args.root)
    if args.install:
        subprocess.run([sys.executable, "-m", "pip", "install", str(output)], check=True)
    print(json.dumps(provenance, indent=2))
