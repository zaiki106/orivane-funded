"""Secondary free-quota adapters and optional read-only MT5; secrets stay in env."""
from __future__ import annotations

import json
import math
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from .storage import DEFAULT_ROOT, ProcessLock, atomic_json, initialize, read_json, utc_now

KEY_NAMES = {"twelve": "TWELVE_DATA_API_KEY", "alpha": "ALPHA_VANTAGE_API_KEY"}
QUOTAS = {"twelve": {"daily": 800, "minute": 8}, "alpha": {"daily": 25, "minute": 1}}
SYMBOLS = {"BTC/USD", "EUR/USD", "GBP/USD", "XAU/USD"}


class ProviderError(RuntimeError):
    pass


def redact(value, secret):
    if isinstance(value, str):
        return value.replace(secret, "[redacted]") if secret else value
    if isinstance(value, list):
        return [redact(item, secret) for item in value]
    if isinstance(value, dict):
        return {key: "[redacted]" if key.lower() in ("apikey", "authorization", "token") else redact(item, secret) for key, item in value.items()}
    return value


def quota_request(provider, endpoint, params, root=DEFAULT_ROOT):
    root = initialize(root)
    secret = os.environ.get(KEY_NAMES[provider], "")
    if not secret:
        return {"status": "not_configured", "provider": provider, "keyVariable": KEY_NAMES[provider]}
    with ProcessLock(root, "secondary-provider-quota"):
        quota_path = root / "registry/provider-quotas.json"
        quotas = read_json(quota_path, {})
        day = datetime.now(timezone.utc).date().isoformat()
        previous = quotas.get(provider, {})
        record = previous if previous.get("day") == day else {"day": day, "used": 0, "lastRequestTime": 0}
        recent = [timestamp for timestamp in record.get("recent", []) if time.time() - timestamp < 60]
        limit = QUOTAS[provider]
        if record["used"] >= limit["daily"] or len(recent) >= limit["minute"]:
            return {"status": "quota_limited", "provider": provider, "usedToday": record["used"], "dailyLimit": limit["daily"]}
        # Count attempted requests too. Restarting cannot bypass the free daily budget.
        record.update(used=record["used"] + 1, lastRequestTime=time.time(), recent=recent + [time.time()])
        quotas[provider] = record
        atomic_json(quota_path, quotas)
        payload = dict(params)
        payload["apikey"] = secret
        url = endpoint + "?" + urllib.parse.urlencode(payload)
        request = urllib.request.Request(url, headers={"User-Agent": "OrivanePrivateResearch/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                data = redact(json.loads(response.read(10_000_000)), secret)
        except urllib.error.HTTPError as exc:
            # Never print exceptionURL (contains the APIkey).
            raise ProviderError(f"{provider}HTTPstatus{exc.code}") from None
        except Exception as exc:
            raise ProviderError(f"{provider}requestfailed:{type(exc).__name__}") from None
        if any(name in data for name in ("Note", "Information", "Error Message")) or data.get("status") == "error":
            return {"status": "provider_refused", "provider": provider, "code": data.get("code"), "usedToday": record["used"]}
        return {"status": "received", "provider": provider, "receivedAt": utc_now(), "data": data,
            "usedToday": record["used"], "dailyLimit": limit["daily"]}


def twelve_snapshot(symbol, root=DEFAULT_ROOT):
    if symbol not in SYMBOLS:
        raise ValueError("Only validatedsymbols BTC/USD,EUR/USD,GBP/USD,XAU/USD; noNasdaqproxy")
    result = quota_request("twelve", "https://api.twelvedata.com/time_series",
        {"symbol": symbol, "interval": "15min", "outputsize": 160, "timezone": "UTC", "format": "JSON"}, root)
    if result["status"] != "received":
        return result
    data = result.pop("data")
    if data.get("meta", {}).get("symbol") != symbol:
        raise ProviderError("Providerinstrumentdoesnotmatchrequest")
    bars = []
    for row in reversed(data.get("values", [])):
        timestamp = datetime.fromisoformat(row["datetime"]).replace(tzinfo=timezone.utc)
        values = {name: float(row[name]) for name in ("open", "high", "low", "close")}
        if not all(math.isfinite(value) and value > 0 for value in values.values()):
            raise ProviderError("InvalidactualproviderOHLC")
        if values["low"] > min(values["open"], values["close"]) or values["high"] < max(values["open"], values["close"]):
            raise ProviderError("InconsistentactualproviderOHLC")
        # Exclude currentpartial15minbar; missingvolume staysnull.
        if timestamp.timestamp() + 900 <= time.time():
            bars.append({"time": timestamp.isoformat().replace("+00:00", "Z"), **values,
                "volume": float(row["volume"]) if row.get("volume") is not None else None})
    result.update(symbol=symbol, source="Twelve Data · secondarysnapshot", timeframe=15, bars=bars,
        streaming=False, executable=False, providerTimestamp=bars[-1]["time"] if bars else None,
        timestampPrecision="seconds", metadata=data.get("meta"))
    atomic_json(initialize(root) / "experiments" / f"twelve-{symbol.replace('/', '_')}-snapshot.json", result)
    return result


def alpha_snapshot(symbol, root=DEFAULT_ROOT):
    if symbol not in {"EUR/USD", "GBP/USD"}:
        raise ValueError("FreeFXdailyadaptercurrentlysupportsEUR/USDorGBP/USDonly")
    base, quote = symbol.split("/")
    result = quota_request("alpha", "https://www.alphavantage.co/query",
        {"function": "FX_DAILY", "from_symbol": base, "to_symbol": quote, "outputsize": "compact"}, root)
    if result["status"] != "received":
        return result
    data = result.pop("data")
    today = datetime.now(timezone.utc).date().isoformat()
    bars = [{"time": timestamp, "date": timestamp, "open": float(row["1. open"]), "high": float(row["2. high"]),
        "low": float(row["3. low"]), "close": float(row["4. close"]), "volume": None}
        for timestamp, row in sorted(data.get("Time Series FX (Daily)", {}).items()) if timestamp < today]
    if not bars:
        raise ProviderError("NoactualdailyFXseriesreturned")
    for bar in bars:
        if not all(math.isfinite(bar[key]) and bar[key] > 0 for key in ("open", "high", "low", "close")) or bar["low"] > min(bar["open"], bar["close"]) or bar["high"] < max(bar["open"], bar["close"]):
            raise ProviderError("Invalid actual daily FX OHLC")
    result.update(symbol=symbol, source="Alpha Vantage · dailyverification", timeframe=1440, bars=bars,
        streaming=False, executable=False, timestampPrecision="day", providerTimestamp=bars[-1]["time"], metadata=data.get("Meta Data"))
    atomic_json(initialize(root) / "experiments" / f"alpha-{symbol.replace('/', '_')}-daily.json", result)
    return result


def mt5_snapshot(root=DEFAULT_ROOT, symbols=None, connect=False):
    if not connect:
        return {"status": "not_connected", "source": "MT5optionalread-only", "orderExecution": False}
    try:
        import MetaTrader5 as mt5
    except ImportError:
        return {"status": "not_installed", "source": "MT5optionalread-only", "orderExecution": False}
    selected = symbols or {"BTC/USD": "BTCUSD", "EUR/USD": "EURUSD", "GBP/USD": "GBPUSD", "XAU/USD": "XAUUSD"}
    path = os.environ.get("ORIVANE_MT5_TERMINAL_PATH")
    initialized = mt5.initialize(path=path) if path else mt5.initialize()
    if not initialized:
        return {"status": "terminal_unavailable", "source": "MT5optionalread-only", "orderExecution": False}
    try:
        datasets = []
        for symbol, broker_symbol in selected.items():
            if symbol not in SYMBOLS | {"NDX"}:
                raise ValueError("Unknownlogicalinstrument")
            info, tick = mt5.symbol_info(broker_symbol), mt5.symbol_info_tick(broker_symbol)
            if not info or not tick or not 0 < tick.bid < tick.ask:
                datasets.append({"symbol": symbol, "brokerSymbol": broker_symbol, "status": "unavailable"})
                continue
            rates = mt5.copy_rates_from_pos(broker_symbol, mt5.TIMEFRAME_M15, 1, 2000)
            bars = [] if rates is None else [{"time": datetime.fromtimestamp(int(row["time"]), timezone.utc).isoformat().replace("+00:00", "Z"),
                "open": float(row["open"]), "high": float(row["high"]), "low": float(row["low"]), "close": float(row["close"]),
                "volume": None, "tickCount": int(row["tick_volume"])} for row in rates if int(row["time"]) + 900 <= time.time()]
            received = int(time.time() * 1000)
            datasets.append({"symbol": symbol, "brokerSymbol": broker_symbol, "source": "MT5 terminal · brokerquotes", "timeframe": 15,
                "instrumentKind": "brokerContract", "ndxIndex": False if symbol == "NDX" else None,
                "status": "fresh_terminal_snapshot" if 0 <= received - tick.time_msc < 30_000 else "stale_terminal_snapshot",
                "quote": {"bid": tick.bid, "ask": tick.ask, "providerTimeMs": tick.time_msc, "receivedTimeMs": received,
                    "timestampPrecision": "milliseconds", "streaming": False}, "bars": bars,
                "contract": {"digits": info.digits, "tickSize": info.trade_tick_size, "contractSize": info.trade_contract_size},
                "orderExecution": False})
        result = {"status": "read_only_snapshot", "source": "MT5 terminal · brokerquotes", "receivedAt": utc_now(), "datasets": datasets,
            "orderExecution": False, "accountIdentifiersExported": False}
        atomic_json(initialize(root) / "experiments/mt5-read-only-snapshot.json", result)
        return result
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("provider", choices=("twelve", "alpha", "mt5"))
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--symbol", default="EUR/USD")
    parser.add_argument("--mt5-connect", action="store_true")
    args = parser.parse_args()
    try:
        result = twelve_snapshot(args.symbol, args.root) if args.provider == "twelve" else alpha_snapshot(args.symbol, args.root) if args.provider == "alpha" else mt5_snapshot(args.root, connect=args.mt5_connect)
        print(json.dumps(result, indent=2, allow_nan=False))
    except ProviderError as exc:
        raise SystemExit(str(exc)) from None
