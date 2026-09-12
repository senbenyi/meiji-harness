#!/usr/bin/env python3
"""Serve the two existing Third Cup deliverables on loopback; never expose directories."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
FILES = {
    '/third-cup/film.mp4': ROOT / 'out/third-cup-preview/第三杯咖啡-六分钟预览.mp4',
    '/third-cup/subtitles.srt': ROOT / 'docs/implement/third-cup-preview/subtitles.srt',
}


class DeliveryHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        path = FILES.get(urlsplit(self.path).path)
        if path is None or not path.is_file():
            self.send_error(404)
            return None
        stream = path.open('rb')
        self.send_response(200)
        self.send_header('Content-Type', 'video/mp4' if path.suffix == '.mp4' else 'application/x-subrip; charset=utf-8')
        self.send_header('Content-Length', str(path.stat().st_size))
        self.send_header('Content-Disposition', "attachment; filename*=UTF-8''" + quote(path.name))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        return stream


if __name__ == '__main__':
    for path in FILES.values():
        if not path.is_file():
            raise SystemExit(f'Missing deliverable: {path}')
    ThreadingHTTPServer(('127.0.0.1', 3081), DeliveryHandler).serve_forever()
