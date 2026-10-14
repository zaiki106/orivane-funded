"""Binary TP-before-SL models; untouched chronological test governs paper publication."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

from .storage import DEFAULT_ROOT, BudgetWrite, ProcessLock, atomic_json, initialize, require_capacity, utc_now

POLICY = "trade-publication-v1"
SCHEMA = "trade-tp-before-sl-v1"


def chronological_split(examples, embargo_ms=16 * 15 * 60_000, boundaries=None):
    """Partition on unique entry timestamps, never split same-time setups across folds."""
    examples = sorted((e for e in examples if e.get("y") in (0, 1) and not e.get("censored")), key=lambda e: (e["entryTimeMs"], e["id"]))
    times = sorted({e["entryTimeMs"] for e in examples})
    if len(times) < 10:
        raise ValueError("At least ten unique timestamps are required")
    development_end = boundaries["trainEndMs"] if boundaries else times[int(len(times) * .5)]
    calibration_end = boundaries["calibrationEndMs"] if boundaries else times[int(len(times) * .75)]
    if not development_end < calibration_end:
        raise ValueError("Invalid chronological partition boundaries")
    development = [e for e in examples if e["entryTimeMs"] < development_end and e["labelEndTimeMs"] < development_end]
    calibration = [e for e in examples if e["entryTimeMs"] >= development_end + embargo_ms and e["entryTimeMs"] < calibration_end and e["labelEndTimeMs"] < calibration_end]
    test_end = boundaries.get("testEndMs", math.inf) if boundaries else math.inf
    test = [e for e in examples if calibration_end + embargo_ms <= e["entryTimeMs"] <= test_end and e["labelEndTimeMs"] <= test_end]
    return development, calibration, test, {"developmentEndMs": development_end, "calibrationEndMs": calibration_end,
        "embargoMs": embargo_ms, "counts": [len(development), len(calibration), len(test)]}


def nonoverlapping(examples):
    selected, end = [], -math.inf
    for example in sorted(examples, key=lambda e: (e["entryTimeMs"], e["id"])):
        if example["entryTimeMs"] > end:
            selected.append(example)
            end = example["labelEndTimeMs"]
    return selected


def expectancy_interval(values, repetitions=2000, mean_block=4, seed=71421):
    """Stationary block bootstrap; historical interval, never a forecast."""
    import numpy as np

    values = np.asarray(values, dtype=float)
    if len(values) < 30 or not np.all(np.isfinite(values)):
        return None
    rng = np.random.default_rng(seed)
    means = np.empty(repetitions)
    for iteration in range(repetitions):
        indices = np.empty(len(values), dtype=np.int64)
        current = int(rng.integers(len(values)))
        for step in range(len(values)):
            if step and rng.random() < 1 / mean_block:
                current = int(rng.integers(len(values)))
            elif step:
                current = (current + 1) % len(values)
            indices[step] = current
        means[iteration] = values[indices].mean()
    return [float(x) for x in np.quantile(means, [.025, .975])]


def publication_report(examples, probabilities, baseline, context):
    import numpy as np

    if len(examples) != len(probabilities):
        raise ValueError("Probability/example length mismatch")
    y = np.asarray([e["y"] for e in examples])
    probabilities = np.asarray(probabilities)
    brier = float(np.mean((probabilities - y) ** 2)) if len(y) else None
    baseline_brier = float(np.mean((baseline - y) ** 2)) if len(y) else None
    # Match browser Math.round(p*1000)/10: the displayed percentage must exceed60.
    mask = np.floor(probabilities * 1000 + .5) > 600
    returns = [float(e["netR"]) for e, selected in zip(examples, mask) if selected]
    interval = expectancy_interval(returns)
    expectancy = float(np.mean(returns)) if returns else None
    report = {"policyVersion": POLICY, "nonOverlapping": len(examples), "positive": int(sum(y == 1)), "negative": int(sum(y == 0)),
        "aboveThreshold": int(sum(mask)), "brier": brier, "baselineBrier": baseline_brier, "netExpectancy": expectancy,
        "expectancyInterval": interval, "evaluatedThroughMs": max((e["labelEndTimeMs"] for e in examples), default=None), **context}
    reasons = []
    if len(examples) < 200:
        reasons.append("insufficient_nonoverlapping_oos")
    if report["positive"] < 40 or report["negative"] < 40:
        reasons.append("insufficient_outcome_classes")
    if report["aboveThreshold"] < 30:
        reasons.append("insufficient_above_60_percent")
    if brier is None or brier >= baseline_brier:
        reasons.append("no_brier_advantage")
    if expectancy is None or expectancy <= 0 or interval is None or interval[0] <= 0:
        reasons.append("net_expectancy_not_demonstrated")
    report.update(passed=not reasons, status="paper" if not reasons else "observation", rejectionReasons=reasons)
    return report


def _train(input_path: Path, root: Path = DEFAULT_ROOT):
    import lightgbm as lgb
    import numpy as np
    from scipy.special import expit
    from sklearn.linear_model import LogisticRegression
    from sklearn.preprocessing import StandardScaler

    root = initialize(root)
    data = json.loads(Path(input_path).read_text(encoding="utf-8"))
    examples = data.get("examples", [])
    names = data.get("features", data.get("featureNames"))
    if not names or not examples:
        raise ValueError("Trade examples and named features are required")
    metadata = data["metadata"]
    if data.get("schema", data.get("schemaVersion")) != SCHEMA or metadata.get("outcomeVersion", "trade-barriers-v1") != "trade-barriers-v1":
        raise ValueError("Unsupported target schema/outcome version")
    if metadata.get("entryPolicy") != "next-closed-bar-boundary-v1" or metadata.get("maxEntryDelayMs") != 60_000:
        raise ValueError("Re-export setups with the stable closed-bar entry policy before training")
    symbol, source = metadata["symbol"], metadata["source"]
    cost = metadata["cost"]
    max_bars = metadata.get("maxBars", 16)
    if max_bars != 16:
        raise ValueError("This model release supports the approved16-bar horizon only")
    for example in examples:
        if example.get("censored") or example.get("y") is None:
            continue
        if not (example["featureTimeMs"] <= example["entryTimeMs"] <= example["labelEndTimeMs"] <= example["entryTimeMs"] + max_bars * 15 * 60_000):
            raise ValueError("Future feature or impossible outcome timestamp")
        if not math.isfinite(example["netR"]):
            raise ValueError("Nonfinite actual outcome")
    development, calibration, test, split = chronological_split(examples, embargo_ms=max_bars * 15 * 60_000, boundaries=metadata.get("split"))
    test = nonoverlapping(test)
    for title, partition in (("development", development), ("calibration", calibration)):
        if len(partition) < 40 or len({e["y"] for e in partition}) != 2:
            raise ValueError(f"Insufficient actual {title} examples/classes")
    if not test:
        raise ValueError("No untouched non-overlapping test examples")

    def arrays(partition):
        x = np.asarray([e["features"] for e in partition], dtype=float)
        if x.shape[1] != len(names) or not np.all(np.isfinite(x)):
            raise ValueError("Feature vector mismatch or nonfinite features")
        return x, np.asarray([e["y"] for e in partition], dtype=int)

    train_x, train_y = arrays(development)
    cal_x, cal_y = arrays(calibration)
    test_x, test_y = arrays(test)
    scaler = StandardScaler().fit(train_x)
    logistic = LogisticRegression(C=1.0, max_iter=1000, random_state=42).fit(scaler.transform(train_x), train_y)
    boosting = lgb.LGBMClassifier(n_estimators=120, max_depth=4, num_leaves=15, learning_rate=.04, min_child_samples=40,
        reg_lambda=2, subsample=1, colsample_bytree=1, random_state=42, n_jobs=4, verbosity=-1).fit(train_x, train_y)
    candidates = []
    for algorithm, model in (("logistic", logistic), ("lightgbm", boosting)):
        def margin(x):
            return model.decision_function(scaler.transform(x)) if algorithm == "logistic" else model.predict(x, raw_score=True)
        cal_margin = margin(cal_x)
        calibrator = LogisticRegression(C=1_000_000, max_iter=1000, random_state=42).fit(cal_margin.reshape(-1, 1), cal_y)
        a, b = float(calibrator.coef_[0][0]), float(calibrator.intercept_[0])
        calibrated = expit(a * cal_margin + b)
        brier = float(np.mean((calibrated - cal_y) ** 2))
        predictor = {"weights": model.coef_[0].tolist(), "intercept": float(model.intercept_[0]), "mean": scaler.mean_.tolist(),
            "scale": scaler.scale_.tolist()} if algorithm == "logistic" else {"modelDump": model.booster_.dump_model()}
        test_margin = margin(test_x)
        candidates.append({"algorithm": algorithm, "predictor": predictor, "calibration": {"method": "platt", "a": a, "b": b},
            "calibrationBrier": brier, "testProbabilities": expit(a * test_margin + b), "testMargins": test_margin})
    selected = min(candidates, key=lambda row: row["calibrationBrier"])
    if not math.isfinite(selected["calibrationBrier"]):
        raise ValueError("Nonfinite calibration; no publishable model")
    trained_through = max(e["labelEndTimeMs"] for e in calibration)
    context = {"symbol": symbol, "source": source, "cost": cost, "maxBars": max_bars, "outcomeVersion": "trade-barriers-v1",
        "strategyMode": metadata.get("strategyMode", "routed"), "h1Policy": metadata.get("h1Policy", "align-if-available"),
        "registryVersion": metadata.get("registryVersion", "orivane-strategy-registry-v1"), "entryPolicy": metadata["entryPolicy"],
        "maxEntryDelayMs": metadata["maxEntryDelayMs"]}
    model = {"schemaVersion": SCHEMA, "kind": "tp_before_sl_probability", **context, "featureNames": names,
        "trainedThroughMs": trained_through, "trainedThrough": datetime_iso(trained_through),
        "algorithm": selected["algorithm"], "predictor": selected["predictor"], "calibration": selected["calibration"],
        "publication": publication_report(test, selected["testProbabilities"], float(train_y.mean()), context)}
    model["publicationReport"] = model["publication"]
    synthetic = bool(metadata.get("synthetic") or "fixture" in source.lower())
    if synthetic:
        model["publication"].update(passed=False, status="observation")
        model["publication"]["rejectionReasons"].append("synthetic_fixture_never_published")
    identifier = hashlib.sha256(json.dumps(model, sort_keys=True).encode()).hexdigest()[:16]
    model["id"] = identifier
    experiment = {"schemaVersion": 1, "id": identifier, "generatedAt": utc_now(), "inputSha256": hashlib.sha256(Path(input_path).read_bytes()).hexdigest(),
        "symbol": symbol, "source": source, "split": split, "censored": sum(bool(e.get("censored")) for e in examples),
        "selection": "calibration_brier_only", "testUsedForSelection": False, "baseline": float(train_y.mean()),
        "variants": [{**{k: row[k] for k in ("algorithm", "calibrationBrier", "calibration")}, "calibrationSign": "positive" if row["calibration"]["a"] > 0 else "negative"} for row in candidates],
        "publicationReport": model["publicationReport"], "modelFile": f"models/{identifier}.json"}
    oracles = [{"model": {**{key: model[key] for key in ("schemaVersion", "kind", "symbol", "source", "featureNames", "trainedThrough",
            "trainedThroughMs", "outcomeVersion", "maxBars", "cost", "strategyMode", "h1Policy", "registryVersion", "entryPolicy", "maxEntryDelayMs")}, "algorithm": row["algorithm"], "predictor": row["predictor"],
            "calibration": row["calibration"], "publication": {"passed": False, "status": "observation"}},
        "observations": [{"id": example["id"], "features": example["features"], "rawScore": float(margin), "probability": float(probability)}
            for example, margin, probability in list(zip(test, row["testMargins"], row["testProbabilities"]))[:10]]}
        for row in candidates]
    oracle_payload = {"source": "synthetic test fixture" if synthetic else "actual provider observations", "synthetic": synthetic, "oracles": oracles}
    estimated = sum(len(json.dumps(payload).encode("utf-8")) for payload in (model, experiment, oracle_payload)) + len(json.dumps(model).encode("utf-8")) + 1_000_000
    with BudgetWrite(root, estimated):
        atomic_json(root / "models" / f"{identifier}.json", model)
        atomic_json(root / "experiments" / f"train-{identifier}.json", experiment)
        atomic_json(root / "experiments" / f"oracle-{identifier}.json", oracle_payload)
        # Observation models never replace promoted models.
        if model["publicationReport"]["passed"] and context["strategyMode"] == "routed" and context["h1Policy"] == "align-if-available":
            atomic_json(root / "models" / f"published-{symbol.replace('/', '_')}.json", model)
    return {"id": identifier, "model": str(root / "models" / f"{identifier}.json"), "experiment": str(root / "experiments" / f"train-{identifier}.json"),
        "publicationReport": model["publicationReport"]}


def datetime_iso(milliseconds):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(milliseconds / 1000, timezone.utc).isoformat().replace("+00:00", "Z")


def train(input_path: Path, root: Path = DEFAULT_ROOT):
    root = initialize(root)
    with ProcessLock(root):
        return _train(input_path, root)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    args = parser.parse_args()
    print(json.dumps(train(args.input, args.root), indent=2))
