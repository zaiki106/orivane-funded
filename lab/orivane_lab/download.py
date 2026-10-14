"""Resumable official Kraken corpus, four bounded curl transfers, SHA256 verified."""
from __future__ import annotations

import concurrent.futures
import hashlib
import json
import re
import subprocess
import threading
import time
from pathlib import Path

from .storage import DEFAULT_ROOT, BudgetWrite, ProcessLock, atomic_json, initialize, read_json, require_capacity, utc_now

BASE = "https://assets.kraken.com/marketing/institutions/"
CHECKSUM_URL = BASE + "Trades_Full_PARTS_SHA256SUMS.txt"
CORPUS_BYTES = 28_516_267_234
PART_BYTES = 2_097_152_000
COMBINED_SHA256 = "5f5affd6c341366cdc5db290beaf281b8e362fd650bc9273aac6defdcaa98018"
SOURCE_PAGE = "https://support.kraken.com/articles/360047543791-downloadable-historical-market-data-time-and-sales-"


def curl(*args):
    return subprocess.run(["curl.exe", "--silent", "--show-error", "--fail", "--location", "--user-agent", "Mozilla/5.0 OrivanePrivateResearch/1.0", *args], check=True, capture_output=True, text=True, encoding="utf-8", errors="replace")


def sha256(path: Path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def load_checksums(root: Path):
    text = curl("--max-time", "60", CHECKSUM_URL).stdout
    rows = {}
    for line in text.splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})\s+\*?(Kraken_Trades_Full\.zip\.part\d{2})", line.strip())
        if not match:
            raise ValueError(f"Invalid official checksum row: {line[:120]}")
        rows[match[2]] = match[1]
    expected = {f"Kraken_Trades_Full.zip.part{i:02d}" for i in range(14)}
    if set(rows) != expected:
        raise ValueError("Official manifest must list exactly parts00..13")
    (root / "raw/kraken/Trades_Full_PARTS_SHA256SUMS.txt").write_text(text, encoding="utf-8")
    return rows


def _download(root: Path = DEFAULT_ROOT, workers: int = 4):
    root = initialize(root)
    if workers not in range(1, 5):
        raise ValueError("Download workers must be between 1 and 4")
    rows = load_checksums(root)
    raw = root / "raw/kraken"
    sizes = {name: PART_BYTES if int(name[-2:]) < 13 else CORPUS_BYTES - 13 * PART_BYTES for name in rows}
    remaining = sum(max(0, sizes[name] - ((raw / name).stat().st_size if (raw / name).exists() else 0)) for name in rows)
    # Previous downloadingstate already commits the entire28.52GB corpus to the budget.
    active = read_json(root / "registry/kraken-corpus.json", {}).get("status") in ("downloading", "verifying_combined")
    require_capacity(root, 0 if active else remaining)
    previous = read_json(root / "registry/kraken-corpus.json", {})
    state = {"schemaVersion": 1, "status": "downloading", "source": SOURCE_PAGE, "checksumSource": CHECKSUM_URL,
        "private": True, "expectedBytes": CORPUS_BYTES, "startedAt": previous.get("startedAt", utc_now()),
        "parts": {name: {"url": BASE + name, "expectedBytes": sizes[name], "expectedSha256": digest,
            "status": "pending", "downloadedBytes": 0} for name, digest in rows.items()}}
    lock = threading.RLock()
    done = threading.Event()

    def persist():
        with lock:
            for name, item in state["parts"].items():
                path = raw / name
                item["downloadedBytes"] = path.stat().st_size if path.exists() else 0
            state["downloadedBytes"] = sum(item["downloadedBytes"] for item in state["parts"].values())
            state["updatedAt"] = utc_now()
            atomic_json(root / "registry/kraken-corpus.json", state)

    def progress():
        while not done.wait(15):
            persist()
            print(json.dumps({"downloadedBytes": state["downloadedBytes"], "expectedBytes": CORPUS_BYTES,
                "verifiedParts": sum(p["status"] == "verified" for p in state["parts"].values())}), flush=True)

    def part(name):
        path = raw / name
        with lock:
            state["parts"][name]["status"] = "downloading"
        existing = path.stat().st_size if path.exists() else 0
        if existing > sizes[name]:
            raise ValueError(f"Oversized existing part {name}; preserved for investigation")
        if existing != sizes[name]:
            curl("--connect-timeout", "30", "--max-time", "14400", "--max-filesize", str(sizes[name]), "--retry", "5", "--retry-delay", "4",
                "--continue-at", "-", "--output", str(path), BASE + name)
        if path.stat().st_size != sizes[name]:
            raise ValueError(f"Size mismatch for {name}")
        with lock:
            state["parts"][name]["status"] = "verifying"
        actual = sha256(path)
        if actual != rows[name]:
            with lock:
                state["parts"][name].update(status="checksum_failed", actualSha256=actual)
            raise ValueError(f"SHA256 mismatch for {name}; file preserved")
        with lock:
            state["parts"][name].update(status="verified", actualSha256=actual, verifiedAt=utc_now())
        persist()
        print(json.dumps({"part": name, "status": "verified", "bytes": path.stat().st_size}), flush=True)

    # Commit the whole known corpus before transfersstart. Otherwriters budget thisreservation.
    with BudgetWrite(root, 0 if active else remaining):
        persist()
    reporter = threading.Thread(target=progress, daemon=True)
    reporter.start()
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(part, name): name for name in rows}
            for future in concurrent.futures.as_completed(futures):
                future.result()
        # Verify the concatenated ZIP without writing another 28.52GB duplicate.
        state["status"] = "verifying_combined"
        persist()
        digest = hashlib.sha256()
        for name in sorted(rows):
            with (raw / name).open("rb") as stream:
                while chunk := stream.read(8 * 1024 * 1024):
                    digest.update(chunk)
        actual = digest.hexdigest()
        if actual != COMBINED_SHA256:
            raise ValueError("Combined SHA256 mismatch; all source files preserved")
        state.update(status="verified", combinedSha256=actual, verifiedAt=utc_now())
        persist()
        return state
    except Exception as exc:
        state.update(status="failed", error=str(exc))
        persist()
        raise
    finally:
        done.set()
        reporter.join(timeout=2)


def download(root: Path = DEFAULT_ROOT, workers: int = 4):
    root = initialize(root)
    with ProcessLock(root):
        return _download(root, workers)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    print(json.dumps(download(args.root, args.workers), indent=2), flush=True)
