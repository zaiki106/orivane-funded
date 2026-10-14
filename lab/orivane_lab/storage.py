from __future__ import annotations

import json
import os
import shutil
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_ROOT = Path(__file__).resolve().parents[2] / "orivane-data"
BUDGET_BYTES = 100_000_000_000
_lock = threading.RLock()


class ProcessLock:
    """OS lock survives neither process exit nor crash; no stale lock deletion needed."""
    def __init__(self, root: Path, name="heavy-task"):
        if not name or not all(c.isalnum() or c == "-" for c in name):
            raise ValueError("Invalid lock name")
        self.path = Path(root) / f"registry/{name}.lock"
        self.stream = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.stream = self.path.open("a+b")
        self.stream.seek(0, os.SEEK_END)
        if not self.stream.tell():
            self.stream.write(b"0")
            self.stream.flush()
        self.stream.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            self.stream.close()
            raise RuntimeError("Another heavy Orivane process is running") from exc
        return self

    def __exit__(self, *args):
        self.stream.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(self.stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(self.stream.fileno(), fcntl.LOCK_UN)
        self.stream.close()


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def initialize(root: Path = DEFAULT_ROOT):
    root = Path(root).resolve()
    for folder in ("raw/kraken", "normalized", "experiments", "models", "registry", "tasks"):
        (root / folder).mkdir(parents=True, exist_ok=True)
    registry = root / "registry/storage.json"
    if not registry.exists():
        atomic_json(registry, {"schemaVersion": 1, "private": True, "budgetBytes": BUDGET_BYTES,
            "spaces": ["raw", "normalized", "experiments", "models"], "createdAt": utc_now()})
    return root


def atomic_json(path: Path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with _lock:
        with temporary.open("w", encoding="utf-8") as stream:
            json.dump(value, stream, indent=2, ensure_ascii=False, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)


def usage(root: Path):
    return sum(p.stat().st_size for p in Path(root).rglob("*") if p.is_file())


def require_capacity(root: Path, additional: int, budget: int = BUDGET_BYTES):
    if additional < 0:
        raise ValueError("Additional storage must be non-negative")
    corpus = read_json(Path(root) / "registry/kraken-corpus.json", {})
    if corpus.get("status") in ("downloading", "verifying_combined"):
        # Count the full committed source download once, independent of concurrent rawgrowth.
        raw_directory = (Path(root) / "raw/kraken").resolve()
        parts = {f"Kraken_Trades_Full.zip.part{i:02d}" for i in range(14)}
        used = sum(path.stat().st_size for path in Path(root).rglob("*") if path.is_file() and
            not (path.parent.resolve() == raw_directory and path.name in parts)) + 28_516_267_234
    else:
        used = usage(root)
    if used + additional > budget:
        raise RuntimeError(f"Storage budget exceeded: {used}+{additional}>{budget}; sources preserved")
    if shutil.disk_usage(root).free < additional + 1_000_000_000:
        raise RuntimeError("Insufficient free disk space; sources preserved")
    return used


class BudgetWrite:
    """Serialize capacity-check plus write across collector and all heavyprocesses."""
    def __init__(self, root: Path, additional: int):
        self.root, self.additional = Path(root), additional
        self.lock = None

    def __enter__(self):
        deadline = time.monotonic() + 30
        while True:
            candidate = ProcessLock(self.root, "storage-budget")
            try:
                candidate.__enter__()
                self.lock = candidate
                break
            except RuntimeError:
                if time.monotonic() >= deadline:
                    raise RuntimeError("Shared storage budget lock timed out")
                time.sleep(.05)
        try:
            require_capacity(self.root, self.additional + 1_000_000)
        except Exception:
            self.lock.__exit__(None, None, None)
            raise
        return self

    def __exit__(self, *args):
        self.lock.__exit__(*args)


def read_json(path: Path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default
