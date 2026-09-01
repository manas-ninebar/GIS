# Serve ns-qaw-a and proxy OpenAI so the browser never holds a CORS fight.
#   python serve.py
# Key: paste in Copilot, or set OPENAI_API_KEY. Never commit it.
from __future__ import annotations

import json
import os
import ssl
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", "8765"))
OPENAI = "https://api.openai.com/v1/chat/completions"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(HERE), **kwargs)

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} {fmt % args}")

    def _send_json(self, code, payload):
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-OpenAI-Key")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.end_headers()

    def do_POST(self):
        if self.path.rstrip("/") != "/api/chat":
            self.send_error(404)
            return
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n)
        key = (self.headers.get("X-OpenAI-Key") or os.environ.get("OPENAI_API_KEY") or "").strip()
        if not key:
            self._send_json(401, {"error": "OPENAI_API_KEY is not set on the server."})
            return
        req = urllib.request.Request(
            OPENAI,
            data=body,
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        ctx = ssl.create_default_context()
        try:
            with urllib.request.urlopen(req, context=ctx, timeout=60) as res:
                data = res.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except urllib.error.HTTPError as err:
            msg = err.read().decode("utf-8", "replace")
            try:
                payload = json.loads(msg)
            except json.JSONDecodeError:
                payload = {"error": msg[:400]}
            self._send_json(err.code, payload)
        except Exception as err:
            self._send_json(502, {"error": str(err)})


if __name__ == "__main__":
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"NineOne Geo  http://127.0.0.1:{PORT}/")
    httpd.serve_forever()
