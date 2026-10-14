"""Real provider smoke evidence; optional full archive replay after normalization."""
from __future__ import annotations

import json
import tempfile
from decimal import Decimal
from pathlib import Path

from .download import curl
from .replay import compare_indicators, load_trade_sample, nautilus_replay
from .storage import DEFAULT_ROOT, atomic_json, initialize, read_json, utc_now


def verify(root=DEFAULT_ROOT):
    import duckdb
    import pyarrow as pa
    import pyarrow.parquet as pq

    root = initialize(root)
    result = {"generatedAt": utc_now(), "synthetic": False, "orderExecution": False, "checks": {}}
    payload = json.loads(curl("--max-time", "60", "https://api.kraken.com/0/public/Trades?pair=XBTUSD&count=1000").stdout, parse_float=Decimal)
    if payload.get("error"):
        raise ValueError(f"Kraken provider returned error: {payload['error']}")
    rows = next(value for key, value in payload["result"].items() if key != "last")
    trades = [{"timestamp_ms": int(Decimal(str(row[2])) * 1000), "timestamp_ns": int(Decimal(str(row[2])) * 1_000_000_000), "price": float(row[0]), "volume": float(row[1]),
        "type": row[3], "trade_id": str(row[6]) if len(row) > 6 else f"kraken-{index}"} for index, row in enumerate(rows)]
    atomic_json(root / "raw/kraken/rest-trades-sample.json", {"source": "Kraken RESTTrades", "receivedAt": utc_now(),
        "providerCursor": payload["result"]["last"], "historicalSnapshot": True, "trades": trades})
    result["checks"]["nautilusActualTrades"] = nautilus_replay(trades)
    # Verify Arrow/DuckDB actual trade interoperability with an independent sum.
    with tempfile.TemporaryDirectory(prefix="orivane-verify-", dir=root / "experiments") as directory:
        path = Path(directory) / "actual-trades.parquet"
        pq.write_table(pa.Table.from_pylist(trades), path)
        with duckdb.connect() as connection:
            count, volume = connection.execute("SELECT count(*),sum(volume) FROM read_parquet(?)", [str(path)]).fetchone()
        if count != len(trades) or abs(volume - sum(row["volume"] for row in trades)) > 1e-8:
            raise ValueError("Arrow/DuckDB actual trade interoperability mismatch")
        result["checks"]["duckdbActualTrades"] = {"version": duckdb.__version__, "arrowVersion": pa.__version__, "rows": count, "volume": volume}
    bars_path = root / "experiments/BTC_USD-15m.json"
    if bars_path.exists():
        result["checks"]["taLibActualBars"] = compare_indicators(read_json(bars_path)["bars"])
        result["checks"]["nautilusArchiveTrades"] = nautilus_replay(load_trade_sample(root))
    else:
        # Actual previously captured provider bars, never the synthetic test fixture.
        captured = Path(__file__).resolve().parents[2] / "hold-real-datasets.json"
        if captured.exists():
            datasets = read_json(captured)
            datasets = datasets.get("datasets", []) if isinstance(datasets, dict) else datasets
            btc = next(row for row in datasets if row["symbol"] == "BTC/USD")
            result["checks"]["taLibActualBars"] = compare_indicators(btc["bars"])
        result["checks"]["archive"] = {"status": read_json(root / "registry/kraken-corpus.json", {}).get("status", "not_downloaded"),
            "meaning": "Full corpus evidence requires completed normalization"}
    atomic_json(root / "experiments/verification-real.json", result)
    return result


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    args = parser.parse_args()
    print(json.dumps(verify(args.root), indent=2))
