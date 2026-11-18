"""Local preview server for beefgrading.study that never lets the browser cache.

Plain `python -m http.server` sends no cache headers, so browsers reuse stale
CSS/JS after edits and pages render half old, half new.

Run from anywhere:  python beefgrading.study/deployment/devserver.py [port]
"""
import functools
import http.server
import pathlib
import sys

SITE = pathlib.Path(__file__).resolve().parent.parent


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = functools.partial(NoCacheHandler, directory=str(SITE))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"Serving {SITE} at http://localhost:{port} (no-cache)")
        httpd.serve_forever()
