"""Independent event replay adapters. Trades never masquerade as historical bid/ask."""
from __future__ import annotations

from decimal import Decimal
from pathlib import Path


def load_trade_sample(root: Path, instrument="BTC/USD", limit=2000):
    import duckdb

    if not 1 <= limit <= 100_000:
        raise ValueError("Replay sample limit must be1..100000")
    pattern = str(Path(root) / "normalized/provider=kraken" / f"instrument={instrument.replace('/', '_')}" / "date=*/*.parquet")
    with duckdb.connect() as connection:
        rows = connection.execute("""SELECT timestamp_ms,price,volume,type,trade_id,timestamp_ns FROM read_parquet(?)
            ORDER BY timestamp_ns DESC, sequence DESC LIMIT ?""", [pattern, limit]).fetchall()
    return [{"timestamp_ms": r[0], "price": r[1], "volume": r[2], "type": r[3], "trade_id": r[4], "timestamp_ns": r[5]} for r in reversed(rows)]


def nautilus_replay(rows):
    """Feed actual trade events through Nautilus and independently audit order/count."""
    from nautilus_trader.backtest.engine import BacktestEngine
    from nautilus_trader.config import BacktestEngineConfig, LoggingConfig
    from nautilus_trader.model.currencies import BTC, USD
    from nautilus_trader.model.data import TradeTick
    from nautilus_trader.model.enums import AccountType, AggressorSide, OmsType
    from nautilus_trader.model.identifiers import InstrumentId, Symbol, TradeId, TraderId, Venue
    from nautilus_trader.model.instruments import CurrencyPair
    from nautilus_trader.model.objects import Money, Price, Quantity
    from nautilus_trader.trading.strategy import Strategy

    instrument_id = InstrumentId.from_str("BTC/USD.KRAKEN")
    instrument = CurrencyPair(instrument_id=instrument_id, raw_symbol=Symbol("XBTUSD"), base_currency=BTC, quote_currency=USD,
        price_precision=2, size_precision=8, price_increment=Price.from_str("0.01"), size_increment=Quantity.from_str("0.00000001"),
        ts_event=0, ts_init=0, maker_fee=Decimal("0.001"), taker_fee=Decimal("0.001"))
    ticks = []
    for index, row in enumerate(rows):
        price = Price.from_str(f"{row['price']:.2f}")
        size = Quantity.from_str(f"{row['volume']:.8f}")
        if size.as_double() <= 0:
            continue
        side = AggressorSide.BUYER if row["type"] == "b" else AggressorSide.SELLER if row["type"] == "s" else AggressorSide.NO_AGGRESSOR
        event_time = int(row.get("timestamp_ns", int(row["timestamp_ms"]) * 1_000_000))
        ticks.append(TradeTick(instrument_id, price, size, side,
            TradeId(str(row.get("trade_id") or f"archive-{index}")), event_time, event_time))
    if not ticks:
        raise ValueError("No positive-volume trade events")
    if any(b.ts_event < a.ts_event for a, b in zip(ticks, ticks[1:])):
        raise ValueError("Unordered trade feed")

    class Observer(Strategy):
        def __init__(self):
            super().__init__()
            self.events = []

        def on_start(self):
            self.subscribe_trade_ticks(instrument_id)

        def on_trade_tick(self, tick):
            self.events.append((tick.ts_event, tick.price.as_double(), tick.size.as_double()))

    engine = BacktestEngine(config=BacktestEngineConfig(trader_id=TraderId("ORIVANE-001"), logging=LoggingConfig(log_level="ERROR")))
    engine.add_venue(venue=Venue("KRAKEN"), oms_type=OmsType.NETTING, account_type=AccountType.CASH,
        starting_balances=[Money(100_000, USD), Money(1, BTC)])
    engine.add_instrument(instrument)
    observer = Observer()
    engine.add_strategy(observer)
    engine.add_data(ticks)
    engine.run()
    observed = observer.events
    engine.dispose()
    if len(observed) != len(ticks) or any(b[0] < a[0] for a, b in zip(observed, observed[1:])):
        raise ValueError("Nautilus event replay mismatch")
    return {"engine": "NautilusTrader", "version": "1.231.0", "events": len(observed), "firstTimestampNs": observed[0][0],
        "lastTimestampNs": observed[-1][0], "firstPrice": observed[0][1], "lastPrice": observed[-1][1],
        "orderExecution": False, "historicalBidAskAvailable": False,
        "inputTimestampPrecision": "source-nanoseconds" if all("timestamp_ns" in row for row in rows) else "milliseconds",
        "meaning": "Causal trade replay; archive contains trades, not executable historical bid/ask"}


def depth_replay(events, *, tick_size=.01, lot_size=.00000001, latency_ns=5_000_000):
    """Replay verified L2 events only. Queue/latency settings are explicit assumptions."""
    import numpy as np
    from hftbacktest import BacktestAsset, HashMapMarketDepthBacktest
    from hftbacktest.types import event_dtype

    rows = np.zeros(len(events), dtype=event_dtype)
    for index, event in enumerate(events):
        for name in event_dtype.names:
            rows[index][name] = event.get(name, 0)
        if rows[index]["local_ts"] < rows[index]["exch_ts"]:
            raise ValueError("Local reception must not precede exchange event time")
    if len(rows) < 2:
        raise ValueError("At least two actual L2 events are required")
    asset = (BacktestAsset().data([rows]).linear_asset(1).constant_order_latency(latency_ns, latency_ns)
        .risk_adverse_queue_model().no_partial_fill_exchange().trading_value_fee_model(.001, .001).tick_size(tick_size).lot_size(lot_size))
    backtest = HashMapMarketDepthBacktest([asset])
    delta = max(1, int(rows["local_ts"].max() - min(rows["exch_ts"].min(), rows["local_ts"].min())) + 1)
    backtest.elapse(delta)
    depth = backtest.depth(0)
    best_bid, best_ask = float(depth.best_bid), float(depth.best_ask)
    backtest.close()
    return {"engine": "hftbacktest", "version": "2.4.4", "events": len(rows), "bestBid": best_bid, "bestAsk": best_ask,
        "latencyNs": latency_ns, "latencyAssumed": True, "queueModel": "risk_adverse", "orderExecution": False}


def compare_indicators(bars):
    """Independent TA-Lib arithmetic baseline on an actual OHLC corpus."""
    import numpy as np
    import talib

    if len(bars) < 50:
        raise ValueError("At least50 actual bars required")
    high, low, close = (np.asarray([bar[key] for bar in bars], dtype=float) for key in ("high", "low", "close"))
    sma = talib.SMA(close, timeperiod=20)
    direct = float(close[-20:].mean())
    if not np.isclose(sma[-1], direct, rtol=1e-12):
        raise ValueError("TA-Lib SMA differs from independent arithmetic")
    return {"engine": "TA-Lib", "version": talib.__version__, "samples": len(bars), "sma20": float(sma[-1]),
        "rsi14": float(talib.RSI(close, timeperiod=14)[-1]), "atr14": float(talib.ATR(high, low, close, timeperiod=14)[-1]),
        "smaVerified": True}


def replay_live_capture(root: Path, message_limit=5000):
    import json
    from decimal import Decimal
    from hftbacktest import BUY_EVENT, DEPTH_EVENT, EXCH_EVENT, LOCAL_EVENT, SELL_EVENT
    from .collector import KrakenBook
    from .storage import atomic_json, utc_now

    book = KrakenBook()
    events, observed, gaps = [], 0, 0
    previous_session = None
    for path in sorted((Path(root) / "raw/kraken-live").glob("date=*/*.jsonl")):
        with path.open(encoding="utf-8") as stream:
            for line in stream:
                record = json.loads(line)
                if record["channel"] == "gap":
                    gaps += 1
                    book.reset()
                    continue
                if record["channel"] != "book" or not record["checksumVerified"]:
                    continue
                if previous_session is not None and previous_session != record["sessionId"]:
                    # Keep each independent session in its own replay, never bridge a disconnect.
                    break
                previous_session = record["sessionId"]
                if record["providerTimeNs"] is None or record["clockSkewDetected"]:
                    raise ValueError("Capture lacks replayable synchronized provider timestamp")
                message = json.loads(record["payloadJson"], parse_float=Decimal)
                old = {"bids": dict(book.bids), "asks": dict(book.asks)}
                for row in message["data"]:
                    book.apply(row, snapshot=message["type"] == "snapshot")
                for side, flag in (("bids", BUY_EVENT), ("asks", SELL_EVENT)):
                    current = getattr(book, side)
                    for price in sorted(old[side].keys() | current.keys()):
                        quantity = current.get(price, Decimal(0))
                        if old[side].get(price) == quantity:
                            continue
                        events.append({"ev": DEPTH_EVENT | EXCH_EVENT | LOCAL_EVENT | flag,
                            "exch_ts": record["providerTimeNs"], "local_ts": record["receivedTimeNs"], "px": float(price), "qty": float(quantity)})
                observed += 1
                if observed >= message_limit:
                    break
        if observed >= message_limit:
            break
    if gaps:
        raise ValueError("Capture contains a connection gap; replay each complete session separately")
    report = depth_replay(events, tick_size=.1)
    if report["bestBid"] != float(max(book.bids)) or report["bestAsk"] != float(min(book.asks)):
        raise ValueError("hftbacktest bestquotes disagree with CRCverified captured book")
    report.update(source="Kraken public · spot", symbol="BTC/USD", capturedBookMessages=observed, actualQuotes=True,
        subscriptionDepth=10, trimPolicy="out-of-subscription levels removed", generatedAt=utc_now())
    atomic_json(Path(root) / "experiments/hftbacktest-real-capture.json", report)
    return report


if __name__ == "__main__":
    import argparse, json
    from .storage import DEFAULT_ROOT
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--live-capture", action="store_true")
    args = parser.parse_args()
    print(json.dumps(replay_live_capture(args.root) if args.live_capture else nautilus_replay(load_trade_sample(args.root)), indent=2))
