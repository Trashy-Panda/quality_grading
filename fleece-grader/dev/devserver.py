"""No-cache local server for fleece-grader. Run: python fleece-grader/dev/devserver.py [port]"""
import functools, http.server, pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate"); self.send_header("Expires", "0"); super().end_headers()
    def log_message(self, *a): pass
if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8012
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(H, directory=str(ROOT))) as s:
        print(f"Serving {ROOT} at http://localhost:{port} (no-cache)", flush=True); s.serve_forever()
