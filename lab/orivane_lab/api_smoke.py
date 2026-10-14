"""Exercise the separately-running real local API without printing its secret."""
from __future__ import annotations
import json
import urllib.error
import urllib.request
from .storage import DEFAULT_ROOT, atomic_json, read_json, utc_now


def smoke(port=8765):
    token = read_json(DEFAULT_ROOT / "registry/api-token.json")["token"]
    base = f"http://127.0.0.1:{port}"
    evidence = {"generatedAt": utc_now(), "local": True, "checks": {}}

    def request(path, body=None, headers=None):
        try:
            req = urllib.request.Request(base + path, data=body, headers=headers or {})
            with urllib.request.urlopen(req, timeout=20) as result:
                return result.status, json.load(result)
        except urllib.error.HTTPError as exc:
            return exc.code, json.load(exc)

    authenticated = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}
    for path in ("/api/status", "/api/datasets"):
        code, body = request(path, headers=authenticated)
        if code != 200:
            raise RuntimeError("Authenticated real API unavailable")
        evidence["checks"][path] = {"httpStatus": code, "keys": list(body)}
    cases = [("unauthorized", "/api/status", None, {}, 401),
        ("external_host", "/api/status", None, {**authenticated, "Host": "attacker.invalid"}, 403),
        ("external_origin", "/api/status", None, {**authenticated, "Origin": "https://attacker.invalid"}, 403),
        ("nan_body", "/api/tasks", b'{"kind":"train","options":{"input":"missing.json","invalid":NaN}}', authenticated, 400),
        ("large_body", "/api/tasks", b"x" * 20_000, authenticated, 413),
        ("arbitrary_task", "/api/tasks", b'{"kind":"shell","options":{"cmd":"anything"}}', authenticated, 400)]
    for name, path, body, headers, expected in cases:
        actual, result = request(path, body, headers)
        if actual != expected:
            raise RuntimeError(f"Real API case{name}expected{expected}received{actual}")
        evidence["checks"][name] = {"httpStatus": actual, "passed": True}
    atomic_json(DEFAULT_ROOT / "experiments/api-real-smoke.json", evidence)
    return evidence


if __name__ == "__main__":
    print(json.dumps(smoke(), indent=2))
