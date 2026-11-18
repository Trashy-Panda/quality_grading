"""No-cache local server for the fleece grader. Run: python fleece-grader/dev/devserver.py [port]

Shipped files live in beefgrading.study/fleece/; dev pages, tests and private scans stay in fleece-grader/.
This server maps both onto one origin so dev pages keep their relative paths:
  /dev/..., /tests/..., /assets/test/...  -> fleece-grader/
  everything else (/omr.js, /assets/blank-sheet.jpg, ...) -> beefgrading.study/fleece/
"""
import http.server, pathlib, sys
DEV = pathlib.Path(__file__).resolve().parent.parent
SHIPPED = DEV.parent / "beefgrading.study" / "fleece"
DEV_PREFIXES = ("dev", "tests", "SPEC.md", "assets/test")
class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        rel = super().translate_path(path)  # resolved against self.directory (SHIPPED)
        sub = pathlib.Path(rel).relative_to(SHIPPED).as_posix()
        if sub == "." or not any(sub == p or sub.startswith(p + "/") for p in DEV_PREFIXES):
            return rel
        return str(DEV / sub)
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate"); self.send_header("Expires", "0"); super().end_headers()
    def log_message(self, *a): pass
if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8012
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), lambda *a, **k: H(*a, directory=str(SHIPPED), **k)) as s:
        print(f"Serving {SHIPPED} + dev overlay {DEV} at http://localhost:{port} (no-cache)", flush=True); s.serve_forever()
