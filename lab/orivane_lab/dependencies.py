"""Exact environment closure and license inventory; no unrelatedpackages or privatepaths."""
from __future__ import annotations

import importlib.metadata as metadata
import json
import platform
from pathlib import Path

from .storage import atomic_json, read_json, utc_now


def inventory(kind="core"):
    from packaging.requirements import Requirement
    from packaging.utils import canonicalize_name

    lab = Path(__file__).resolve().parents[1]
    names = [Requirement(line).name for line in (lab / "requirements.txt").read_text().splitlines() if line.strip() and not line.startswith("#")]
    if kind == "qlib":
        names = ["pyqlib"]
    pending = [(name, frozenset()) for name in names]
    visited, records = set(), {}
    while pending:
        name, extras = pending.pop()
        canonical = canonicalize_name(name)
        if (canonical, extras) in visited:
            continue
        visited.add((canonical, extras))
        distribution = metadata.distribution(name)
        license_name = distribution.metadata.get("License-Expression") or distribution.metadata.get("License") or "Seeinstalledlicensefiles"
        records[canonical] = {"name": distribution.metadata["Name"], "version": distribution.version,
            "licenseMetadata": license_name.strip().splitlines()[0][:250], "projectUrls": distribution.metadata.get_all("Project-URL", []),
            "direct": canonical in {canonicalize_name(root) for root in names}, "requirements": distribution.requires or []}
        for specifier in distribution.requires or []:
            requirement = Requirement(specifier)
            if requirement.marker is not None and not any(requirement.marker.evaluate({"extra": extra}) for extra in extras or {""}):
                continue
            pending.append((requirement.name, frozenset(requirement.extras)))
    lock_name = "requirements-lock.txt" if kind == "core" else "requirements-qlib-lock.txt"
    (lab / lock_name).write_text("# Exactinstalleddependencyclosure; generatedafterfunctionalverification.\n" +
        "\n".join(f"{row['name']}=={row['version']}" for key, row in sorted(records.items())) + "\n", encoding="utf-8")
    result = {"schemaVersion": 1, "environment": kind, "python": platform.python_version(), "platform": platform.system(),
        "architecture": platform.machine(), "generatedAt": utc_now(), "packages": [row for key, row in sorted(records.items())]}
    atomic_json(lab / f"dependency-manifest-{kind}.json", result)
    combined = {"schemaVersion": 1, "environments": {environment: read_json(lab / f"dependency-manifest-{environment}.json")
        for environment in ("core", "qlib")}}
    atomic_json(lab / "dependency-manifest.json", combined)
    return {"environment": kind, "packages": len(records), "lock": lock_name}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", choices=("core", "qlib"), default="core")
    args = parser.parse_args()
    print(json.dumps(inventory(args.kind)))
