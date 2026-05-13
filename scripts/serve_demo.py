from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os


ROOT = Path(__file__).resolve().parents[1] / "docs" / "design"


class Utf8NoCacheHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def guess_type(self, path):
        content_type = super().guess_type(path)
        if path.endswith(".html"):
            return "text/html; charset=utf-8"
        if path.endswith(".css"):
            return "text/css; charset=utf-8"
        if path.endswith(".js"):
            return "application/javascript; charset=utf-8"
        return content_type

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main():
    host = os.environ.get("MLAGENT_DEMO_HOST", "127.0.0.1")
    port = int(os.environ.get("MLAGENT_DEMO_PORT", "5173"))
    server = ThreadingHTTPServer((host, port), Utf8NoCacheHandler)
    print(f"Serving MLAgent demo at http://{host}:{port}/polished-mockup.html")
    server.serve_forever()


if __name__ == "__main__":
    main()
