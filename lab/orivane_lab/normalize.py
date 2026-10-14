"""Stream a verified ZIP member into bounded Parquet batches, then SQL OHLC."""
from __future__ import annotations

import json
import re
from decimal import Decimal
from datetime import datetime, timezone
from pathlib import Path

from .archives import inspect_corpus, open_corpus
from .download import curl, sha256
from .storage import DEFAULT_ROOT, BudgetWrite, ProcessLock, atomic_json, initialize, read_json, require_capacity, utc_now


def timestamp_nanoseconds(column):
    import pyarrow as pa
    import pyarrow.compute as pc
    if column.null_count:
        raise ValueError("Null source timestamp")
    # Decimal CSV parsing preserves the source lexeme; arithmetic never passes throughfloat.
    exact = pc.cast(column, pa.decimal128(19, 9))
    multiplied = pc.multiply(exact, pa.scalar(Decimal("1000000000"), type=pa.decimal128(10, 0)))
    return pc.cast(multiplied, pa.int64())


def member_aliases(root, instrument):
    aliases = {instrument.replace("/", "")}
    if instrument == "BTC/USD":
        return aliases | {"XBTUSD", "XXBTZUSD"}
    path = Path(root) / "registry/kraken-asset-pairs.json"
    if path.exists() and datetime.now(timezone.utc).timestamp() - path.stat().st_mtime < 86_400:
        payload = read_json(path)
    else:
        payload = json.loads(curl("--max-time", "60", "https://api.kraken.com/0/public/AssetPairs").stdout)
        if payload.get("error"):
            raise ValueError("Official paircatalog unavailable; no instrumentguessing")
        atomic_json(path, payload)
    for name, row in payload.get("result", {}).items():
        wsname = row.get("wsname", "").upper().replace("XBT/", "BTC/")
        if wsname == instrument:
            aliases.update({name.upper(), row["altname"].upper()})
    return aliases


def partition_manifest(output: Path):
    import pyarrow.parquet as pq
    return [{"path": str(path.relative_to(output)).replace("\\", "/"), "bytes": path.stat().st_size,
        "sha256": sha256(path), "rows": pq.ParquetFile(path).metadata.num_rows}
        for path in sorted(output.glob("date=*/part-*.parquet"))]


def validate_completed_partitions(previous, output: Path, since):
    """Missing files can be replayed; modified registered files demand investigation."""
    paths = {str(path.relative_to(output)).replace("\\", "/"): path for path in output.glob("date=*/part-*.parquet")}
    expected = {item["path"]: item for item in previous.get("partitionsManifest", [])}
    if expected:
        if set(expected) - set(paths):
            return False
        if set(paths) - set(expected):
            raise ValueError("Unregistered normalized partition; sources preserved")
        for name, item in expected.items():
            if paths[name].stat().st_size != item["bytes"] or sha256(paths[name]) != item["sha256"]:
                raise ValueError("Modified normalized partition; sources preserved for investigation")
        return True
    # Upgrade a completed pre-manifest dataset after matching its recorded byte/row counts.
    manifest = partition_manifest(output)
    rows = sum(item["rows"] for item in manifest if item["path"].split("/", 1)[0][5:] >= (since or ""))
    if sum(item["bytes"] for item in manifest) != previous["parquetBytes"] or rows != previous["normalizedRows"]:
        return False
    previous["partitionsManifest"] = manifest
    return True


def _normalize(root: Path = DEFAULT_ROOT, instrument="BTC/USD", member=None, since="2024-09-30"):
    import pyarrow as pa
    import pyarrow.compute as pc
    import pyarrow.csv as csv
    import pyarrow.parquet as pq

    root = initialize(root)
    cutoff_ns = int(datetime.strptime(since, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()) * 1_000_000_000 if since else 0
    if not re.fullmatch(r"[A-Z0-9]+/[A-Z0-9]+", instrument):
        raise ValueError("Instrument must be BASE/QUOTE")
    catalog = inspect_corpus(root)
    atomic_json(root / "registry/kraken-archive.json", catalog)
    aliases = member_aliases(root, instrument)
    candidates = [row for row in catalog["members"] if Path(row["name"]).stem.upper() in aliases]
    if member is None:
        if len(candidates) != 1:
            raise ValueError(f"Archive member selection ambiguous: {candidates}; provide exact member")
        member = candidates[0]["name"]
    info = next((row for row in catalog["members"] if row["name"] == member), None)
    if not info or not member.endswith(".csv"):
        raise ValueError("Unknown CSV member")
    if member not in {row["name"] for row in candidates}:
        raise ValueError("Selected CSV does not match the requested logical instrument")
    # A member is never extracted in full; enforce the budget before every output chunk.
    output = root / "normalized/provider=kraken" / f"instrument={instrument.replace('/', '_')}"
    output.mkdir(parents=True, exist_ok=True)
    status_path = root / "registry" / f"normalized-{instrument.replace('/', '_')}.json"
    previous = read_json(status_path, {})
    if previous.get("status") == "complete" and previous.get("normalizationVersion") == "kraken-decimal-ns-v1" and previous.get("since") == since and previous.get("archiveSha256") == read_json(root / "registry/kraken-corpus.json")["combinedSha256"]:
        if validate_completed_partitions(previous, output, since):
            atomic_json(status_path, previous)
            return previous
    require_capacity(root, 64_000_000)
    state = {"schemaVersion": 1, "status": "normalizing", "source": "Kraken official time-and-sales", "instrument": instrument,
        "normalizationVersion": "kraken-decimal-ns-v1",
        "member": member, "archiveSha256": read_json(root / "registry/kraken-corpus.json")["combinedSha256"],
        "memberUncompressedBytes": info["uncompressedBytes"], "rows": 0, "normalizedRows": 0, "since": since,
        "batches": 0, "startedAt": utc_now(), "private": True}
    atomic_json(status_path, state)
    types = {"timestamp": pa.decimal128(30, 9), "price": pa.float64(), "volume": pa.float64(), "type": pa.string(),
        "order_type": pa.string(), "misc": pa.string(), "trade_id": pa.string()}
    minimum = maximum = previous_time = first_output_ns = last_output_ns = None
    with open_corpus(root) as archive, archive.open(member) as stream:
        reader = csv.open_csv(stream, read_options=csv.ReadOptions(block_size=16 * 1024 * 1024),
            convert_options=csv.ConvertOptions(column_types=types, strings_can_be_null=True))
        for batch_index, batch in enumerate(reader):
            table = pa.Table.from_batches([batch])
            if set(types) - set(table.column_names):
                raise ValueError("Official CSV schema differs from seven-column published specification")
            nanoseconds = timestamp_nanoseconds(table["timestamp"])
            times = nanoseconds.to_numpy(zero_copy_only=False)
            prices = table["price"].to_numpy(zero_copy_only=False)
            volumes = table["volume"].to_numpy(zero_copy_only=False)
            import numpy as np
            if not len(times):
                continue
            if not np.all(np.isfinite(times)) or not np.all(np.isfinite(prices)) or not np.all(np.isfinite(volumes)) or not np.all(prices > 0) or not np.all(volumes >= 0) or np.any(np.diff(times) < 0):
                raise ValueError("Invalid, nonfinite or unordered actual trades")
            if previous_time is not None and times[0] < previous_time:
                raise ValueError("Trades are unordered across chunks")
            previous_time = int(times[-1])
            minimum = int(times[0]) if minimum is None else minimum
            maximum = int(times[-1])
            milliseconds = pa.array(times // 1_000_000, type=pa.int64())
            table = table.append_column("timestamp_ns", nanoseconds).append_column("timestamp_ms", milliseconds).append_column("sequence", pa.array(np.arange(state["rows"], state["rows"] + len(times), dtype="int64")))
            table = table.filter(pc.greater_equal(table["timestamp_ns"], cutoff_ns))
            if len(table):
                first_output_ns = table["timestamp_ns"][0].as_py() if first_output_ns is None else first_output_ns
                last_output_ns = table["timestamp_ns"][-1].as_py()
                dates = pc.strftime(pc.cast(table["timestamp_ms"], pa.timestamp("ms", "UTC")), format="%Y-%m-%d")
                table = table.append_column("date", dates)
            for date in pc.unique(dates).to_pylist() if len(table) else []:
                part = table.filter(pc.equal(dates, date)).drop(["date"])
                directory = output / f"date={date}"
                directory.mkdir(exist_ok=True)
                destination = directory / f"part-{batch_index:06d}.parquet"
                if destination.exists():
                    # Reused output must equal this causal source chunk, never just share its name.
                    if not pq.ParquetFile(destination).read().equals(part):
                        raise ValueError("Resumed Parquet differs from the verified source chunk; sources preserved")
                else:
                    with BudgetWrite(root, part.nbytes + 16_000_000):
                        temp = destination.with_suffix(".parquet.tmp")
                        pq.write_table(part, temp, compression="zstd", row_group_size=128_000)
                        temp.replace(destination)
            state["rows"] += len(times)
            state["normalizedRows"] += len(table)
            state["batches"] += 1
            state["updatedAt"] = utc_now()
            atomic_json(status_path, state)
            if batch_index % 10 == 0:
                print(json.dumps({"instrument": instrument, "rows": state["rows"], "batches": state["batches"]}), flush=True)
    if first_output_ns is None:
        raise ValueError("Official member contains no actual trades in the requested date range")
    state.update(status="complete", firstTradeMs=first_output_ns // 1_000_000, lastTradeMs=last_output_ns // 1_000_000,
        firstTradeNs=first_output_ns, lastTradeNs=last_output_ns, sourceFirstTradeNs=minimum, sourceLastTradeNs=maximum,
        timestampPrecision="source-decimal-nanoseconds", completedAt=utc_now(),
        parquetBytes=sum(p.stat().st_size for p in output.rglob("*.parquet")), partitions=len(list(output.glob("date=*"))),
        partitionsManifest=partition_manifest(output))
    atomic_json(status_path, state)
    return state


def _export_ohlc(root: Path = DEFAULT_ROOT, instrument="BTC/USD", since="2024-09-30", minutes=15):
    import duckdb

    root = initialize(root)
    status = read_json(root / "registry" / f"normalized-{instrument.replace('/', '_')}.json")
    if not status or status.get("status") != "complete":
        raise ValueError("Normalized dataset must be complete before OHLC export")
    if minutes not in (1, 5, 15, 60, 240):
        raise ValueError("Unsupported aggregation interval")
    start = int(datetime.fromisoformat(since).replace(tzinfo=timezone.utc).timestamp()) * 1_000_000_000
    pattern = str(root / "normalized/provider=kraken" / f"instrument={instrument.replace('/', '_')}" / "date=*/*.parquet")
    connection = duckdb.connect(str(root / "registry/catalog.duckdb"))
    connection.execute("SET memory_limit='4GB'")
    connection.execute("SET threads=4")
    view_name = "kraken_" + instrument.replace("/", "_").lower() + "_trades"
    quoted_path = pattern.replace("'", "''")
    connection.execute(f"CREATE OR REPLACE VIEW {view_name} AS SELECT * FROM read_parquet('{quoted_path}',hive_partitioning=true)")
    connection.execute("CREATE TABLE IF NOT EXISTS dataset_registry(instrument VARCHAR PRIMARY KEY, source VARCHAR, archive_sha256 VARCHAR, normalization_version VARCHAR, rows BIGINT, first_trade_ns BIGINT,last_trade_ns BIGINT)")
    connection.execute("INSERT OR REPLACE INTO dataset_registry VALUES (?,?,?,?,?,?,?)", [instrument, "Kraken public · spot", status["archiveSha256"],
        status["normalizationVersion"], status.get("normalizedRows", status["rows"]), status["firstTradeNs"], status["lastTradeNs"]])
    rows = connection.execute("""SELECT (timestamp_ns // ?) * ? AS bucket, arg_min(price, struct_pack(event_ns := timestamp_ns, receive_sequence := sequence)) AS open,
        max(price) AS high, min(price) AS low, arg_max(price,struct_pack(event_ns := timestamp_ns, receive_sequence := sequence)) AS close, sum(volume) AS volume, count(*) AS trade_count
        FROM read_parquet(?, hive_partitioning=true) WHERE timestamp_ns >= ? GROUP BY bucket ORDER BY bucket""",
        [minutes * 60_000_000_000, minutes * 60_000_000_000, pattern, start]).fetchall()
    connection.close()
    bars = [{"time": datetime.fromtimestamp(row[0] // 1_000_000_000, timezone.utc).isoformat().replace("+00:00", "Z"),
        "open": row[1], "high": row[2], "low": row[3], "close": row[4], "volume": row[5], "tradeCount": row[6]} for row in rows]
    end = status["lastTradeNs"]
    # Never invent zero-volume bars; preserve gaps. Incomplete final bucket is excluded.
    bars = [bar for bar, row in zip(bars, rows) if row[0] + minutes * 60_000_000_000 <= end]
    result = {"symbol": instrument, "source": "Kraken public · spot", "timeframe": minutes, "bars": bars,
        "provenance": {"archiveSha256": status["archiveSha256"], "member": status["member"], "historical": True,
            "firstTradeMs": status["firstTradeMs"], "lastTradeMs": status["lastTradeMs"], "lastTradeNs": end, "generatedAt": utc_now()}}
    destination = root / "experiments" / f"{instrument.replace('/', '_')}-{minutes}m.json"
    with BudgetWrite(root, len(json.dumps(result).encode("utf-8")) + 1_000_000):
        atomic_json(destination, result)
    return {"path": str(destination), "bars": len(bars), "first": bars[0]["time"] if bars else None,
        "last": bars[-1]["time"] if bars else None, "historical": True}


def normalize(root: Path = DEFAULT_ROOT, instrument="BTC/USD", member=None, since="2024-09-30"):
    root = initialize(root)
    with ProcessLock(root):
        try:
            return _normalize(root, instrument, member, since)
        except Exception as exc:
            if isinstance(instrument, str) and re.fullmatch(r"[A-Z0-9]+/[A-Z0-9]+", instrument):
                path = root / "registry" / f"normalized-{instrument.replace('/', '_')}.json"
                state = read_json(path)
                if state and state.get("status") == "normalizing":
                    state.update(status="failed", error=str(exc), updatedAt=utc_now())
                    atomic_json(path, state)
            raise


def export_ohlc(root: Path = DEFAULT_ROOT, instrument="BTC/USD", since="2024-09-30", minutes=15):
    root = initialize(root)
    with ProcessLock(root):
        return _export_ohlc(root, instrument, since, minutes)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--instrument", default="BTC/USD")
    parser.add_argument("--member")
    parser.add_argument("--since", default="2024-09-30")
    args = parser.parse_args()
    print(json.dumps(normalize(args.root, args.instrument, args.member, args.since), indent=2))
    print(json.dumps(export_ohlc(args.root, args.instrument, args.since), indent=2))
