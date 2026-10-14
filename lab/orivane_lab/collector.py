"""Public Krakenv2 trades/L2 collector; exactdecimalCRC, gaps and bounded storage."""
from __future__ import annotations

import collections
import json
import re
import time
import uuid
import zlib
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from .storage import DEFAULT_ROOT, BudgetWrite, ProcessLock, atomic_json, initialize, require_capacity, utc_now


def timestamp_ns(text):
    if not isinstance(text, str):
        return None, None
    match = re.fullmatch(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z", text)
    if not match:
        raise ValueError("Invalid providerRFC3339timestamp")
    seconds = int(datetime.fromisoformat(match[1]).replace(tzinfo=timezone.utc).timestamp())
    fraction = match[2] or ""
    return seconds * 1_000_000_000 + int(fraction.ljust(9, "0") or "0"), len(fraction)


class KrakenBook:
    def __init__(self, depth=10):
        self.depth = depth
        self.bids, self.asks = {}, {}
        self.valid = False

    def reset(self):
        self.bids, self.asks = {}, {}
        self.valid = False

    @staticmethod
    def digits(value):
        return format(value, "f").replace(".", "").lstrip("0")

    def checksum(self):
        text = "".join(self.digits(price) + self.digits(qty) for book, reverse in ((self.asks, False), (self.bids, True))
            for price, qty in sorted(book.items(), reverse=reverse)[:10])
        return zlib.crc32(text.encode()) & 0xffffffff

    def apply(self, row, snapshot=False):
        if snapshot:
            self.reset()
        elif not self.valid:
            raise ValueError("Book requires a new snapshot")
        for name in ("bids", "asks"):
            book = getattr(self, name)
            for level in row.get(name, []):
                price, quantity = Decimal(str(level["price"])), Decimal(str(level["qty"]))
                if not price.is_finite() or not quantity.is_finite() or price <= 0 or quantity < 0:
                    self.reset()
                    raise ValueError("Invalid actual L2level")
                if quantity == 0:
                    book.pop(price, None)
                else:
                    book[price] = quantity
            keep = dict(sorted(book.items(), reverse=name == "bids")[:self.depth])
            setattr(self, name, keep)
        if not self.bids or not self.asks or max(self.bids) >= min(self.asks) or self.checksum() != row.get("checksum"):
            self.reset()
            raise ValueError("CRC32 mismatch or crossed book; rebuild snapshot required")
        self.valid = True
        return {"bestBid": str(max(self.bids)), "bestAsk": str(min(self.asks)), "checksum": row["checksum"]}


def capture(root=DEFAULT_ROOT, seconds=120):
    from websockets.sync.client import connect
    import numpy as np
    import pyarrow as pa
    import pyarrow.parquet as pq

    if seconds < 0 or seconds > 86_400:
        raise ValueError("seconds must be0(continuous)..86400")
    root = initialize(root)
    deadline = time.monotonic() + seconds if seconds else float("inf")
    state = {"schemaVersion": 1, "source": "Kraken public · spot", "symbol": "BTC/USD", "status": "collecting",
        "startedAt": utc_now(), "messages": 0, "bookMessages": 0, "tradeMessages": 0, "checksumVerified": 0,
        "gaps": 0, "providerSequenceAvailable": False, "timestampPrecision": "nativeRFC3339preserved", "private": True}
    state["clockSynchronizationVerified"] = False
    buffered, latency_samples = [], collections.deque(maxlen=100_000)
    last_trade, sequence = None, 0
    capture_id = uuid.uuid4().hex

    def flush_payload():
        if not buffered:
            return
        require_capacity(root, sum(len(json.dumps(row)) for row in buffered) * 3 + 1_000_000)
        grouped = {}
        for row in buffered:
            date = datetime.fromtimestamp(row["receivedTimeNs"] // 1_000_000_000, timezone.utc).date().isoformat()
            grouped.setdefault(date, []).append(row)
        schema = pa.schema([(name, field_type) for name, field_type in (
            ("source", pa.string()), ("symbol", pa.string()), ("channel", pa.string()), ("messageType", pa.string()),
            ("localSequence", pa.int64()), ("sequenceKind", pa.string()), ("providerSequence", pa.int64()), ("sessionId", pa.string()),
            ("receivedTimeNs", pa.int64()), ("providerTimeNs", pa.int64()), ("providerPrecisionDigits", pa.int16()),
            ("latencyMs", pa.float64()), ("clockSkewDetected", pa.bool_()), ("checksumVerified", pa.bool_()), ("gapReason", pa.string()), ("payloadJson", pa.string()))])
        for date, rows in grouped.items():
            raw_folder = root / "raw/kraken-live" / f"date={date}"
            normalized = root / "normalized/provider=kraken-live/instrument=BTC_USD" / f"date={date}"
            raw_folder.mkdir(parents=True, exist_ok=True)
            normalized.mkdir(parents=True, exist_ok=True)
            with (raw_folder / f"{capture_id}.jsonl").open("a", encoding="utf-8", newline="\n") as stream:
                for row in rows:
                    stream.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
            destination = normalized / f"{capture_id}-{rows[0]['localSequence']:09d}.parquet"
            temporary = destination.with_suffix(".parquet.tmp")
            pq.write_table(pa.Table.from_pylist(rows, schema=schema), temporary, compression="zstd")
            temporary.replace(destination)
        buffered.clear()
        state["updatedAt"] = utc_now()
        state["latencyMs"] = {"count": len(latency_samples), **({"p50": float(np.quantile(latency_samples, .5)), "p95": float(np.quantile(latency_samples, .95)), "p99": float(np.quantile(latency_samples, .99))} if latency_samples else {})}
        atomic_json(root / "registry/kraken-live.json", state)

    def flush():
        if buffered:
            with BudgetWrite(root, sum(len(json.dumps(row).encode("utf-8")) for row in buffered) * 3 + 1_000_000):
                flush_payload()

    def record(channel, kind, received, provider_time, precision, raw, verified, session, gap_reason=None):
        nonlocal sequence
        sequence += 1
        latency = (received - provider_time) / 1_000_000 if provider_time is not None else None
        if latency is not None and latency >= 0:
            latency_samples.append(latency)
        buffered.append({"source": "Kraken public · spot", "symbol": "BTC/USD", "channel": channel, "messageType": kind,
            "localSequence": sequence, "sequenceKind": "local-receive", "providerSequence": None, "sessionId": session,
            "receivedTimeNs": received, "providerTimeNs": provider_time, "providerPrecisionDigits": precision,
            "latencyMs": latency, "clockSkewDetected": latency is not None and latency < 0,
            "checksumVerified": verified, "gapReason": gap_reason, "payloadJson": raw})
        if len(buffered) >= 64:
            flush()

    with ProcessLock(root, "kraken-live-collector"):
        atomic_json(root / "registry/kraken-live.json", state)
        try:
            retries = 0
            while time.monotonic() < deadline:
                book = KrakenBook()
                session = uuid.uuid4().hex
                try:
                    with connect("wss://ws.kraken.com/v2", open_timeout=20, close_timeout=5, max_size=4_000_000) as socket:
                        for channel in ("book", "trade"):
                            parameters = {"channel": channel, "symbol": ["BTC/USD"], "snapshot": True}
                            if channel == "book":
                                parameters["depth"] = 10
                            socket.send(json.dumps({"method": "subscribe", "params": parameters}))
                        retries = 0
                        while time.monotonic() < deadline:
                            try:
                                raw = socket.recv(timeout=min(10, max(.1, deadline - time.monotonic())))
                            except TimeoutError:
                                continue
                            received = time.time_ns()
                            parsed = json.loads(raw, parse_float=Decimal)
                            channel = parsed.get("channel")
                            if parsed.get("success") is False:
                                raise RuntimeError("Public subscription refused")
                            if channel not in ("book", "trade"):
                                continue
                            rows = parsed.get("data", [])
                            if not rows:
                                continue
                            kind = parsed.get("type", "update")
                            if channel == "book":
                                for row in rows:
                                    if row.get("symbol") != "BTC/USD":
                                        raise ValueError("Wrong L2instrument")
                                    book.apply(row, snapshot=kind == "snapshot")
                                    provider_time, precision = timestamp_ns(row.get("timestamp"))
                                    state["checksumVerified"] += 1
                                    state["bookMessages"] += 1
                                    record(channel, kind, received, provider_time, precision, raw, True, session)
                            else:
                                times = [timestamp_ns(row.get("timestamp")) for row in rows]
                                provider_time, precision = max(times, key=lambda value: value[0] or 0)
                                identifiers = [int(row["trade_id"]) for row in rows if row.get("trade_id") is not None]
                                if kind != "snapshot" and identifiers and last_trade is not None and max(identifiers) < last_trade:
                                    raise ValueError("Regressing trade identifier")
                                last_trade = max(identifiers + ([last_trade] if last_trade is not None else []), default=None)
                                state["tradeMessages"] += 1
                                record(channel, kind, received, provider_time, precision, raw, False, session)
                            state["messages"] += 1
                except (KeyboardInterrupt, SystemExit):
                    raise
                except Exception as exc:
                    state["gaps"] += 1
                    record("gap", "disconnect", time.time_ns(), None, None, "", False, session, type(exc).__name__ + ": " + str(exc)[:180])
                    flush()
                    retries += 1
                    if retries >= 5:
                        raise RuntimeError("Five consecutive public stream connection failures") from exc
                    time.sleep(min(2 ** retries, max(0, deadline - time.monotonic())))
            state.update(status="complete", completedAt=utc_now())
        except KeyboardInterrupt:
            state.update(status="stopped", completedAt=utc_now())
        except Exception:
            state["status"] = "failed"
            raise
        finally:
            flush()
            atomic_json(root / "registry/kraken-live.json", state)
    return state


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--seconds", type=int, default=120)
    args = parser.parse_args()
    print(json.dumps(capture(args.root, args.seconds), indent=2))
