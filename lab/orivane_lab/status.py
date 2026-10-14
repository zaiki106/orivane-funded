from __future__ import annotations

import json
from pathlib import Path

from .storage import BUDGET_BYTES, DEFAULT_ROOT, initialize, read_json, usage


def status(root=DEFAULT_ROOT):
    root = initialize(root)
    corpus = read_json(root / "registry/kraken-corpus.json", {})
    return {"private": True, "storageBytes": usage(root), "budgetBytes": BUDGET_BYTES,
        "spaces": {space: usage(root / space) for space in ("raw", "normalized", "experiments", "models")},
        "corpus": {key: corpus.get(key) for key in ("status", "expectedBytes", "downloadedBytes", "combinedSha256", "verifiedAt")},
        "verifiedParts": sum(row.get("status") == "verified" for row in corpus.get("parts", {}).values()),
        "normalized": [read_json(path) for path in (root / "registry").glob("normalized-*.json")],
        "modelCount": len(list((root / "models").glob("*.json"))), "publishedModelCount": len(list((root / "models").glob("published-*.json")))}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    args = parser.parse_args()
    print(json.dumps(status(args.root), indent=2))
