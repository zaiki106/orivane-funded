from __future__ import annotations

import threading
import uuid
import json
from pathlib import Path

from .storage import atomic_json, initialize, read_json, utc_now


class TaskRunner:
    """One heavy writer at a time; task descriptors survive process restart."""
    def __init__(self, root):
        self.root = initialize(root)
        self.lock = threading.Lock()
        for path in (self.root / "tasks").glob("*.json"):
            row = read_json(path, {})
            if row.get("status") == "running":
                row.update(status="interrupted", error="Process ended; retry explicitly to resume", updatedAt=utc_now())
                atomic_json(path, row)

    def start(self, kind, options):
        if kind not in ("download", "normalize", "train"):
            raise ValueError("Unknown task")
        if not isinstance(options, dict):
            raise ValueError("Task options must be an object")
        json.dumps(options, allow_nan=False)
        if not self.lock.acquire(blocking=False):
            raise RuntimeError("A heavy task is already running")
        identifier = uuid.uuid4().hex
        row = {"id": identifier, "kind": kind, "options": options, "status": "running", "createdAt": utc_now()}
        path = self.root / "tasks" / f"{identifier}.json"
        try:
            atomic_json(path, row)
        except Exception:
            self.lock.release()
            raise

        def execute():
            try:
                if kind == "download":
                    from .download import download
                    result = download(self.root, int(options.get("workers", 4)))
                elif kind == "normalize":
                    from .normalize import normalize, export_ohlc
                    instrument = options.get("instrument", "BTC/USD")
                    result = {"normalization": normalize(self.root, instrument, options.get("member"), options.get("since", "2024-09-30")),
                        "ohlc": export_ohlc(self.root, instrument, options.get("since", "2024-09-30"))}
                else:
                    from .train import train
                    requested = Path(options.get("input", ""))
                    input_path = (self.root / requested).resolve()
                    if requested.is_absolute() or not input_path.is_relative_to(self.root) or input_path.suffix != ".json":
                        raise ValueError("Input must be a JSON file within the private data root")
                    result = train(input_path, self.root)
                row.update(status="complete", result=result)
            except Exception as exc:
                row.update(status="failed", error=str(exc))
            finally:
                row["updatedAt"] = utc_now()
                try:
                    atomic_json(path, row)
                finally:
                    self.lock.release()

        try:
            threading.Thread(target=execute, name=f"orivane-{kind}", daemon=False).start()
        except Exception:
            self.lock.release()
            raise
        return row
