"""Source-backed strategy/outcome audit; empirical rates never replace calibrated probability."""
from __future__ import annotations

from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path

from .storage import DEFAULT_ROOT, BudgetWrite, atomic_json, initialize, utc_now
from .train import chronological_split, nonoverlapping


def _margin(features, model):
    predictor = model["predictor"]
    if model["algorithm"] == "logistic":
        return predictor["intercept"] + sum(weight * (value - mean) / scale for value, weight, mean, scale in
            zip(features, predictor["weights"], predictor["mean"], predictor["scale"]))
    total = 0.0
    for tree in predictor["modelDump"]["tree_info"]:
        node = tree["tree_structure"]
        while "leaf_value" not in node:
            if node["decision_type"] != "<=":
                raise ValueError("Unsupported categorical decision in the portable model")
            if node.get("missing_type") == "Zero":
                raise ValueError("Zero-as-missing trees require a matching missing-value adapter")
            node = node["left_child"] if features[node["split_feature"]] <= node["threshold"] else node["right_child"]
        # LightGBM leaf values already include shrinkage.
        total += node["leaf_value"]
    return total


def _probability(features, model):
    z = model["calibration"]["a"] * _margin(features, model) + model["calibration"]["b"]
    return 1 / (1 + math.exp(-z)) if z >= 0 else math.exp(z) / (1 + math.exp(z))


def _outcomes(rows):
    valid = [row for row in rows if row.get("y") in (0, 1) and not row.get("censored")]
    statuses = Counter(row["status"] for row in rows)
    return {"configurations": len(rows), "target": statuses["target"], "stop": statuses["stop"],
        "expired": statuses["expired"], "censored": statuses["censored"],
        "ambiguousStopFirst": sum(bool(row.get("ambiguous")) for row in rows),
        "positive": sum(row["y"] == 1 for row in valid), "negative": sum(row["y"] == 0 for row in valid),
        "empiricalTargetRate": sum(row["y"] == 1 for row in valid) / len(valid) if valid else None,
        "meanNetRAllPlans": sum(row["netR"] for row in valid) / len(valid) if valid else None}


def reliability_bins(rows, probabilities):
    if len(rows) != len(probabilities):
        raise ValueError("Reliability observation/probability mismatch")
    bins = [{"lower": index / 10, "upper": (index + 1) / 10, "n": 0,
        "meanProbability": None, "targetRate": None} for index in range(10)]
    grouped = defaultdict(list)
    for row, probability in zip(rows, probabilities):
        grouped[min(9, math.floor(probability * 10))].append((row["y"], probability))
    for index, values in grouped.items():
        bins[index].update(n=len(values), meanProbability=sum(value[1] for value in values) / len(values),
            targetRate=sum(value[0] for value in values) / len(values))
    return bins


def build_report(input_path: Path, model_path: Path, root: Path = DEFAULT_ROOT):
    import numpy as np

    root = initialize(root)
    input_bytes = Path(input_path).read_bytes()
    model_bytes = Path(model_path).read_bytes()
    data, model = json.loads(input_bytes), json.loads(model_bytes)
    metadata, examples = data["metadata"], data["examples"]
    for key in ("symbol", "source", "cost", "maxBars", "strategyMode", "h1Policy", "registryVersion", "entryPolicy", "maxEntryDelayMs"):
        if model[key] != metadata[key]:
            raise ValueError(f"Model/example context mismatch: {key}")
    if model["featureNames"] != data["features"]:
        raise ValueError("Model/example feature mismatch")
    development, calibration, test, split = chronological_split(examples, boundaries=metadata.get("split"),
        embargo_ms=metadata["maxBars"] * metadata["timeframe"] * 60_000)
    test = nonoverlapping(test)
    probabilities = [_probability(row["features"], model) for row in test]
    if any(not math.isfinite(value) or not 0 <= value <= 1 for value in probabilities):
        raise ValueError("Nonfinite portable model probability")
    measured_brier = float(np.mean([(probability - row["y"]) ** 2 for row, probability in zip(test, probabilities)]))
    measured_above = sum(math.floor(probability * 1000 + .5) > 600 for probability in probabilities)
    publication = model["publication"]
    if len(test) != publication["nonOverlapping"] or measured_above != publication["aboveThreshold"] or not math.isclose(
            measured_brier, publication["brier"], rel_tol=0, abs_tol=1e-12):
        raise ValueError("Portable predictions or test sample do not reproduce the trained publication report")
    grouped, tested = defaultdict(list), defaultdict(list)
    for row in examples:
        grouped[row["strategy"]].append(row)
    for row, probability in zip(test, probabilities):
        tested[row["strategy"]].append((row, probability))
    strategies = []
    for strategy, rows in sorted(grouped.items()):
        pairs = tested[strategy]
        selected = [row for row, probability in pairs if math.floor(probability * 1000 + .5) > 600]
        strategies.append({"id": strategy, "family": rows[0]["family"], "status": "observation",
            "routedOnly": metadata["strategyMode"] == "routed", "allDetected": _outcomes(rows), "nonOverlappingTest": _outcomes([row for row, _ in pairs]),
            "testAbove60": len(selected), "testAbove60Outcomes": _outcomes(selected)})
    report = {"schemaVersion": 1, "generatedAt": utc_now(), "id": model["id"],
        "inputSha256": hashlib.sha256(input_bytes).hexdigest(), "modelSha256": hashlib.sha256(model_bytes).hexdigest(),
        "metadata": metadata, "allDetected": _outcomes(examples), "split": split,
        "nonOverlappingTest": _outcomes(test), "publication": model["publication"],
        "modelAlgorithm": model["algorithm"], "probabilities": {"basis": "calibrated_tp_before_sl_probability",
            "testCount": len(test), "minimum": min(probabilities), "maximum": max(probabilities),
            "quantiles": {str(q): float(np.quantile(probabilities, q)) for q in (.05, .25, .5, .75, .95)},
            "reliabilityBins": reliability_bins(test, probabilities)},
        "strategies": strategies,
        "interpretation": {"empiricalRatesAreConfidence": False, "independentStrategyValidation": False,
            "testWasUsedToSelectModel": False, "ohlcStopAndTargetConvention": "stop-first-same-candle",
            "historicalBidAskAvailable": False, "costAssumptions": bool(metadata["cost"].get("assumption")),
            "globalRejectionsByStrategyAvailable": False}}
    destination = root / "experiments" / f"strategy-audit-{model['id']}.json"
    with BudgetWrite(root, len(json.dumps(report).encode("utf-8")) + 1_000_000):
        atomic_json(destination, report)
    return {"report": str(destination), "id": model["id"], "strategiesObserved": len(strategies),
        "allDetected": report["allDetected"], "nonOverlappingTest": report["nonOverlappingTest"], "probabilities": report["probabilities"]}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    args = parser.parse_args()
    print(json.dumps(build_report(args.input, args.model, args.root), indent=2))
