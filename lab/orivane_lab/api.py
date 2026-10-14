"""Local-only HTTP API. No arbitrary SQL, shell, paths, trading, or permissive CORS."""
from __future__ import annotations

import hmac
import json
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from .storage import BUDGET_BYTES, DEFAULT_ROOT, atomic_json, initialize, read_json, usage, utc_now
from .tasks import TaskRunner


def summaries(folder: Path):
    result = []
    for path in sorted(folder.glob("*.json")):
        row = read_json(path, {})
        result.append({key: row[key] for key in ("id", "symbol", "source", "instrument", "status", "kind", "publicationReport",
            "createdAt", "generatedAt", "rows", "firstTradeMs", "lastTradeMs", "private") if key in row})
    return result


def create_server(root: Path = DEFAULT_ROOT, port=8765):
    root = initialize(root)
    token_path = root / "registry/api-token.json"
    token_row = read_json(token_path)
    if not token_row:
        token_row = {"token": secrets.token_urlsafe(32), "createdAt": utc_now(), "private": True}
        atomic_json(token_path, token_row)
    token = token_row["token"]
    runner = TaskRunner(root)

    class Handler(BaseHTTPRequestHandler):
        def authorized(self):
            host = self.headers.get("Host", "")
            if host not in (f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"):
                self.respond(403, {"error": "Invalid local host"})
                return False
            origin = self.headers.get("Origin")
            if origin and origin not in (f"http://127.0.0.1:{self.server.server_port}", f"http://localhost:{self.server.server_port}"):
                self.respond(403, {"error": "Cross-origin request blocked"})
                return False
            if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token):
                self.respond(401, {"error": "Local API token required"})
                return False
            return True

        def respond(self, status, body):
            payload = json.dumps(body, ensure_ascii=False, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):
            if not self.authorized():
                return
            path = urlparse(self.path).path
            if path == "/api/status":
                corpus = read_json(root / "registry/kraken-corpus.json", {"status": "not_downloaded"})
                self.respond(200, {"schemaVersion": 1, "local": True, "private": True, "storageBytes": usage(root),
                    "budgetBytes": BUDGET_BYTES, "corpus": {key: corpus.get(key) for key in
                        ("status", "expectedBytes", "downloadedBytes", "combinedSha256", "verifiedAt", "updatedAt")}})
            elif path == "/api/datasets":
                self.respond(200, {"datasets": summaries(root / "registry")})
            elif path == "/api/models":
                self.respond(200, {"models": summaries(root / "models")})
            elif path == "/api/experiments":
                self.respond(200, {"experiments": summaries(root / "experiments")})
            elif path == "/api/tasks":
                self.respond(200, {"tasks": [read_json(p) for p in sorted((root / "tasks").glob("*.json"))]})
            else:
                self.respond(404, {"error": "Unknown endpoint"})

        def do_POST(self):
            if not self.authorized():
                return
            if urlparse(self.path).path != "/api/tasks":
                return self.respond(404, {"error": "Unknown endpoint"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length > 16_384:
                    return self.respond(413, {"error": "Body exceeds16KB limit"})
                if length <= 0:
                    raise ValueError("JSON body required")
                body = json.loads(self.rfile.read(length))
                self.respond(202, runner.start(body["kind"], body.get("options", {})))
            except (ValueError, KeyError, TypeError) as exc:
                self.respond(400, {"error": str(exc)})
            except RuntimeError as exc:
                self.respond(409, {"error": str(exc)})

        def log_message(self, format, *args):
            # Standard access logs do not include authorization headers.
            print(f"local-api {self.address_string()} {format % args}", flush=True)

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    server = create_server(args.root, args.port)
    print(f"Orivane local API http://127.0.0.1:{server.server_port}; token in private registry/api-token.json", flush=True)
    server.serve_forever()
