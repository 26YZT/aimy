from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
import json
from pathlib import Path

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'")
        self.send_header('Permissions-Policy', 'camera=(), microphone=(), display-capture=()')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

server = ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(Path(__file__).parent)))
print(json.dumps({'port':server.server_port,'directory':str(Path(__file__).parent)}),flush=True)
server.serve_forever()
