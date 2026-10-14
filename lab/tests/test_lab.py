import hashlib
import io
import json
import threading
import urllib.error
import urllib.request
import zipfile
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import pytest

from orivane_lab.api import create_server
from orivane_lab.archives import ConcatenatedReader
from orivane_lab.storage import ProcessLock, initialize, read_json, require_capacity
from orivane_lab.train import chronological_split, expectancy_interval, nonoverlapping, publication_report


def test_multipart_zip_crosses_boundaries_without_join(tmp_path):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("MANIFEST.json", '{"build":"fixture-only"}')
        archive.writestr("XBTUSD.csv", "timestamp,price,volume\n1,100,2\n2,102,3\n")
    data = stream.getvalue()
    paths = []
    for index, start in enumerate(range(0, len(data), 19)):
        path = tmp_path / str(index)
        path.write_bytes(data[start:start + 19])
        paths.append(path)
    with ConcatenatedReader(paths) as reader:
        assert reader.read(23) == data[:23]
        reader.seek(-10, io.SEEK_END)
        assert reader.read() == data[-10:]
        with zipfile.ZipFile(reader) as archive:
            assert json.loads(archive.read("MANIFEST.json"))["build"] == "fixture-only"
            assert archive.read("XBTUSD.csv").endswith(b"2,102,3\n")


def test_budget_halts_without_removing_sources(tmp_path):
    initialize(tmp_path)
    source = tmp_path / "raw/source.bin"
    source.write_bytes(b"real-source-preserved")
    with pytest.raises(RuntimeError, match="Storage budget exceeded"):
        require_capacity(tmp_path, 100, budget=1)
    assert source.read_bytes() == b"real-source-preserved"


def test_heavy_lock_rejects_concurrent_and_recovers_after_exit(tmp_path):
    initialize(tmp_path)
    with ProcessLock(tmp_path):
        with pytest.raises(RuntimeError, match="Another heavy"):
            with ProcessLock(tmp_path):
                pass
    with ProcessLock(tmp_path):
        assert True


def test_actual_end_purge_and_embargo():
    examples = [{"id": str(i), "entryTimeMs": i * 1000, "labelEndTimeMs": i * 1000 + 1500, "y": i % 2} for i in range(40)]
    development, calibration, test, split = chronological_split(examples, embargo_ms=2000, boundaries={"trainEndMs": 20_000, "calibrationEndMs": 30_000})
    assert max(e["labelEndTimeMs"] for e in development) < 20_000
    assert min(e["entryTimeMs"] for e in calibration) >= 22_000
    assert max(e["labelEndTimeMs"] for e in calibration) < 30_000
    assert min(e["entryTimeMs"] for e in test) >= 32_000
    selected = nonoverlapping(test)
    assert all(b["entryTimeMs"] > a["labelEndTimeMs"] for a, b in zip(selected, selected[1:]))


def test_exact_60_is_not_above_threshold():
    examples = [{"id": str(i), "y": i % 2, "netR": 1, "labelEndTimeMs": i} for i in range(200)]
    report = publication_report(examples, np.full(200, .6), .5, {"symbol": "fixture", "source": "fixture"})
    assert report["aboveThreshold"] == 0
    assert not report["passed"]
    rounded = publication_report(examples, np.full(200, .60049), .5, {"symbol": "fixture", "source": "fixture"})
    assert rounded["aboveThreshold"] == 0
    above = publication_report(examples, np.full(200, .6005), .5, {"symbol": "fixture", "source": "fixture"})
    assert above["aboveThreshold"] == 200


def test_expired_positive_pnl_remains_event_failure():
    examples = [{"id": str(i), "y": 0, "netR": .4, "labelEndTimeMs": i} for i in range(200)]
    report = publication_report(examples, np.full(200, .9), .1, {"symbol": "fixture", "source": "fixture"})
    assert report["positive"] == 0
    assert report["negative"] == 200
    assert not report["passed"]


def test_bootstrap_historical_negative_mean_is_not_promoted():
    interval = expectancy_interval([-1] * 40, repetitions=200)
    assert interval == [-1.0, -1.0]


def test_local_api_auth_host_and_origin(tmp_path):
    server = create_server(tmp_path, port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}/api/status"
    token = read_json(tmp_path / "registry/api-token.json")["token"]
    try:
        with pytest.raises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(url)
        assert error.value.code == 401
        request = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
        result = json.load(urllib.request.urlopen(request))
        assert result["local"] and result["private"]
        request = urllib.request.Request(url, headers={"Authorization": "Bearer " + token, "Origin": "https://attacker.invalid"})
        with pytest.raises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request)
        assert error.value.code == 403
        request = urllib.request.Request(url, headers={"Authorization": "Bearer " + token, "Host": "attacker.invalid"})
        with pytest.raises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request)
        assert error.value.code == 403
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_nautilus_replay_events_fixture_not_live():
    from orivane_lab.replay import nautilus_replay
    rows = [{"timestamp_ms": 1_700_000_000_000 + i * 1000, "price": 100 + i, "volume": .1,
        "type": "b" if i % 2 else "s", "trade_id": str(i)} for i in range(4)]
    report = nautilus_replay(rows)
    assert report["events"] == 4
    assert report["firstPrice"] == 100
    assert report["lastPrice"] == 103
    assert not report["historicalBidAskAvailable"]


def test_hftbacktest_depth_fixture_not_live():
    from hftbacktest import BUY_EVENT, DEPTH_EVENT, EXCH_EVENT, LOCAL_EVENT, SELL_EVENT
    from orivane_lab.replay import depth_replay
    base = 1_700_000_000_000_000_000
    rows = [{"ev": DEPTH_EVENT | EXCH_EVENT | LOCAL_EVENT | BUY_EVENT, "exch_ts": base, "local_ts": base + 1000, "px": 100, "qty": 2},
        {"ev": DEPTH_EVENT | EXCH_EVENT | LOCAL_EVENT | SELL_EVENT, "exch_ts": base + 1, "local_ts": base + 1001, "px": 101, "qty": 3}]
    report = depth_replay(rows)
    assert report["bestBid"] == 100
    assert report["bestAsk"] == 101
    assert report["latencyAssumed"]


def test_future_test_features_never_change_fitted_predictor(tmp_path):
    from orivane_lab.train import train
    rng = np.random.default_rng(31)
    base = 1_700_000_000_000
    step = 6 * 60 * 60_000
    examples = []
    for i in range(500):
        x = float(rng.normal())
        examples.append({"id": str(i), "entryTimeMs": base + i * step, "featureTimeMs": base + i * step,
            "labelEndTimeMs": base + i * step + 60_000, "y": int(x > .2), "features": [x], "netR": 1 if x > .2 else -1})
    data = {"schema": "trade-tp-before-sl-v1", "features": ["fixture_only"], "examples": examples,
        "metadata": {"symbol": "FIXTURE/USD", "source": "fixture_only_not_live", "synthetic": True,
            "entryPolicy": "next-closed-bar-boundary-v1",
            "maxEntryDelayMs": 60_000,
            "cost": {"feeBps": 1, "slippageBps": 1, "assumption": True}, "maxBars": 16,
            "split": {"trainEndMs": base + 250 * step, "calibrationEndMs": base + 375 * step}}}
    first = tmp_path / "first.json"
    first.write_text(json.dumps(data))
    result = train(first, tmp_path / "data")
    first_model = read_json(result["model"])
    for row in data["examples"][375:]:
        row["features"] = [float(rng.normal() * 100)]
        row["y"] = 1 - row["y"]
        row["netR"] *= -1
    second = tmp_path / "second.json"
    second.write_text(json.dumps(data))
    result = train(second, tmp_path / "data")
    second_model = read_json(result["model"])
    assert first_model["algorithm"] == second_model["algorithm"]
    assert first_model["predictor"] == second_model["predictor"]
    assert first_model["calibration"] == second_model["calibration"]
    assert not first_model["publication"]["passed"]
    assert not second_model["publication"]["passed"]
    assert not list((tmp_path / "data/models").glob("published-*.json"))


def test_decimal_crc_matches_kraken_official_example_and_corruption_resets():
    from orivane_lab.collector import KrakenBook, timestamp_ns
    # Kraken's published numerical reference snapshot, not a live fixture.
    bids = [("45283.5", ".10000000"), ("45283.4", "1.54582015"), ("45282.1", ".10000000"), ("45281.0", ".10000000"),
        ("45280.3", "1.54592586"), ("45279.0", ".07990000"), ("45277.6", ".03310103"), ("45277.5", ".30000000"),
        ("45277.3", "1.54602737"), ("45276.6", ".15445238")]
    asks = [("45285.2", ".00100000"), ("45286.4", "1.54571953"), ("45286.6", "1.54571109"), ("45289.6", "1.54560911"),
        ("45290.2", ".15890660"), ("45291.8", "1.54553491"), ("45294.7", ".04454749"), ("45296.1", ".35380000"),
        ("45297.5", ".09945542"), ("45299.5", ".18772827")]
    row = {"bids": [{"price": Decimal(p), "qty": Decimal(q)} for p, q in bids],
        "asks": [{"price": Decimal(p), "qty": Decimal(q)} for p, q in asks], "checksum": 3310070434}
    book = KrakenBook()
    assert book.apply(row, snapshot=True)["checksum"] == 3310070434
    with pytest.raises(ValueError, match="CRC32"):
        book.apply({"bids": [{"price": Decimal("45283.5"), "qty": Decimal(".10000001")}], "checksum": 3310070434})
    assert not book.valid and not book.bids
    with pytest.raises(ValueError, match="new snapshot"):
        book.apply(row)
    assert timestamp_ns("2023-11-14T22:13:20.123456789Z") == (1_700_000_000_123456789, 9)


def test_provider_budget_persists_and_reflected_secret_is_redacted(tmp_path, monkeypatch):
    from orivane_lab.providers import quota_request
    class FixtureHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            body = json.dumps({"value": 1, "Meta Data": {"url": "https://fixture.invalid?apikey=fixture-secret-not-real", "apikey": "fixture-secret-not-real"}}).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv("ALPHA_VANTAGE_API_KEY", "fixture-secret-not-real")
    try:
        endpoint = f"http://127.0.0.1:{server.server_port}/fixture"
        first = quota_request("alpha", endpoint, {}, tmp_path)
        assert first["status"] == "received"
        assert "fixture-secret-not-real" not in json.dumps(first)
        second = quota_request("alpha", endpoint, {}, tmp_path)
        assert second["status"] == "quota_limited"
        assert read_json(tmp_path / "registry/provider-quotas.json")["alpha"]["used"] == 1
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_timestamp_csv_decimal_never_rounds_trade_into_future_bucket():
    import pyarrow as pa
    import pyarrow.csv as csv
    from orivane_lab.normalize import timestamp_nanoseconds
    payload = b"timestamp\n1791935999.999999999\n1791936000.000000000\n"
    table = csv.read_csv(io.BytesIO(payload), convert_options=csv.ConvertOptions(column_types={"timestamp": pa.decimal128(30, 9)}))
    values = timestamp_nanoseconds(table["timestamp"]).to_pylist()
    assert values == [1791935999999999999, 1791936000000000000]
    bucket_ns = 900_000_000_000
    assert [timestamp // bucket_ns * bucket_ns for timestamp in values] == [1791935100000000000, 1791936000000000000]


def test_bad_task_descriptor_does_not_leak_heavy_lock(tmp_path):
    from orivane_lab.tasks import TaskRunner
    runner = TaskRunner(tmp_path)
    with pytest.raises(ValueError):
        runner.start("train", {"input": "missing.json", "invalid": float("nan")})
    assert runner.lock.acquire(blocking=False)
    runner.lock.release()


def test_pending_archive_is_committed_to_common_budget(tmp_path):
    from orivane_lab.storage import atomic_json
    initialize(tmp_path)
    atomic_json(tmp_path / "registry/kraken-corpus.json", {"status": "downloading"})
    with pytest.raises(RuntimeError, match="Storage budget exceeded"):
        require_capacity(tmp_path, 1, budget=28_000_000_000)
    # The downloadiscommitted, never falselyreported as physicallydownloaded.
    assert not list((tmp_path / "raw/kraken").glob("*.part*"))


def test_csv_to_parquet_to_ohlc_exact_boundaries_and_member_binding(tmp_path, monkeypatch):
    from orivane_lab import normalize as module
    from orivane_lab.storage import atomic_json
    root = initialize(tmp_path / "private-fixture")
    source = tmp_path / "fixture-only.zip"
    csv_data = "timestamp,price,volume,type,order_type,misc,trade_id\n1791935100.000000000,100,.2,b,l,,1\n1791935999.999999999,101,.3,s,l,,2\n1791936000.000000000,102,.4,b,m,,3\n1791936900.000000000,103,.5,s,m,,4\n"
    with zipfile.ZipFile(source, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("XBTUSD.csv", csv_data)
        archive.writestr("ETHUSD.csv", csv_data)
    catalog = {"manifest": {"fixtureOnly": True}, "members": [{"name": name, "uncompressedBytes": len(csv_data)} for name in ("XBTUSD.csv", "ETHUSD.csv")]}
    monkeypatch.setattr(module, "inspect_corpus", lambda _: catalog)
    monkeypatch.setattr(module, "open_corpus", lambda _: zipfile.ZipFile(source))
    atomic_json(root / "registry/kraken-corpus.json", {"status": "verified", "combinedSha256": "fixture-only-not-provider"})
    with pytest.raises(ValueError, match="does not match"):
        module.normalize(root, "BTC/USD", "ETHUSD.csv")
    state = module.normalize(root, "BTC/USD", "XBTUSD.csv")
    assert state["normalizedRows"] == 4
    exported = module.export_ohlc(root, "BTC/USD")
    result = read_json(exported["path"])
    assert len(result["bars"]) == 2
    assert result["bars"][0]["open"] == 100
    assert result["bars"][0]["close"] == 101
    assert result["bars"][0]["high"] == 101
    assert result["bars"][0]["volume"] == pytest.approx(.5)
    assert result["bars"][1]["open"] == 102
    assert result["bars"][1]["volume"] == .4
    partition = next((root / "normalized").rglob("*.parquet"))
    assert state["partitionsManifest"][0]["sha256"]
    atomic_json(root / "registry/normalized-BTC_USD.json", {**state, "status": "interrupted"})
    resumed = module.normalize(root, "BTC/USD", "XBTUSD.csv")
    assert resumed["normalizedRows"] == 4  # Existing Parquet is compared to the actual source chunk.
    partition.unlink()  # Deliberately interrupt the private test fixture, never a real corpus.
    recovered = module.normalize(root, "BTC/USD", "XBTUSD.csv")
    assert recovered["normalizedRows"] == 4 and partition.exists()
    assert read_json(module.export_ohlc(root, "BTC/USD")["path"])["bars"] == result["bars"]
    original = partition.read_bytes()
    partition.write_bytes(b"X" + original[1:])
    with pytest.raises(ValueError, match="Modified normalized partition"):
        module.normalize(root, "BTC/USD", "XBTUSD.csv")
    assert partition.read_bytes().startswith(b"X")  # Corrupt output is preserved, never silently overwritten.


def test_reliability_empty_bins_are_null_and_unit_probability_is_last_bin():
    from orivane_lab.report import reliability_bins
    bins = reliability_bins([{"y": 1}, {"y": 0}, {"y": 1}], [0.1, 0.199, 1.0])
    assert len(bins) == 10 and sum(row["n"] for row in bins) == 3
    assert bins[0]["n"] == 0 and bins[0]["meanProbability"] is None and bins[0]["targetRate"] is None
    assert bins[1]["n"] == 2 and bins[1]["targetRate"] == .5
    assert bins[9]["n"] == 1 and bins[9]["meanProbability"] == 1
