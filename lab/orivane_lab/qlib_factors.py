"""Run with .qlib-venv; point-in-time factors on actual supplied OHLC rows."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .storage import DEFAULT_ROOT, atomic_json, initialize, utc_now


def factors(input_path: Path, root=DEFAULT_ROOT, symbol=None):
    import numpy as np
    import pandas as pd
    import qlib
    from qlib.data.ops import Expression, Mean, Rsquare, Slope, Std

    root = initialize(root)
    parsed = json.loads(Path(input_path).read_text(encoding="utf-8"))
    datasets = parsed.get("datasets", []) if isinstance(parsed, dict) and "datasets" in parsed else parsed if isinstance(parsed, list) else [parsed]
    selected = next((row for row in datasets if not symbol or row["symbol"] == symbol), None)
    if not selected or len(selected["bars"]) < 50:
        raise ValueError("At least50 actual source bars required")
    source_close = np.asarray([bar["close"] for bar in selected["bars"]], dtype=float)
    if not np.all(np.isfinite(source_close)) or not np.all(source_close > 0):
        raise ValueError("Invalid actual prices")
    # Latest20-bar factors need a bounded causal window. Rebase Qlib's rollingregression
    # to match the portable160-bar engine and avoid cumulativeindex cancellation.
    close = source_close[-160:]
    fingerprint = hashlib.sha256(close.tobytes()).hexdigest()

    class ActualSeries(Expression):
        def __str__(self):
            return "ActualClose-" + fingerprint

        def _load_internal(self, instrument, start_index, end_index, *args):
            series = pd.Series(close, index=pd.RangeIndex(len(close)))
            return series.loc[max(0, start_index):end_index]

        def get_longest_back_rolling(self):
            return 0

        def get_extended_window_size(self):
            return 0, 0

    expression = ActualSeries()
    end = len(close) - 1
    outputs = {"mean20": Mean(expression, 20).load(selected["symbol"], 0, end, "15min"),
        "std20": Std(expression, 20).load(selected["symbol"], 0, end, "15min"),
        "slope20": Slope(expression, 20).load(selected["symbol"], 0, end, "15min"),
        "rSquared20": Rsquare(expression, 20).load(selected["symbol"], 0, end, "15min")}
    latest = {key: float(series.iloc[-1]) for key, series in outputs.items()}
    reference_mean = float(close[-20:].mean())
    reference_slope = float(np.polyfit(np.arange(20), close[-20:], 1)[0])
    if not np.isclose(latest["mean20"], reference_mean, rtol=1e-10) or not np.isclose(latest["slope20"], reference_slope, rtol=1e-7, atol=1e-9):
        raise ValueError(f"Qlib factor differs from independent arithmetic: mean{latest['mean20']}vs{reference_mean},slope{latest['slope20']}vs{reference_slope}")
    report = {"engine": "Qlib", "version": qlib.__version__, "symbol": selected["symbol"], "source": selected["source"],
        "bars": len(source_close), "factorWindowBars": len(close), "windowPolicy": "portable-engine-causal-last160",
        "from": selected["bars"][0]["time"], "through": selected["bars"][-1]["time"],
        "latest": latest, "independentReference": {"mean20": reference_mean, "slope20": reference_slope},
        "inputSha256": hashlib.sha256(Path(input_path).read_bytes()).hexdigest(), "closeSha256": fingerprint,
        "sourceCloseSha256": hashlib.sha256(source_close.tobytes()).hexdigest(),
        "causalFactors": True, "modelPublication": False, "generatedAt": utc_now()}
    atomic_json(root / "experiments" / f"qlib-factors-{selected['symbol'].replace('/', '_')}.json", report)
    return report


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--symbol")
    args = parser.parse_args()
    print(json.dumps(factors(args.input, args.root, args.symbol), indent=2))
