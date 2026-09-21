#!/usr/bin/env python3
"""Temporary, read-only static preview with an explicit file and network allowlist."""
import argparse
import ipaddress
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_FILES = {
    'index.html', 'family-tree.html', 'family-tree.css', 'family-tree.js',
    'family-data.json',
}


class PreviewHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        address = ipaddress.ip_address(self.client_address[0])
        if not any(address in network for network in self.server.allowed_networks):
            self.send_error(403, 'This preview is restricted to the local network')
            return None
        path = unquote(urlsplit(self.path).path)
        filename = 'index.html' if path == '/' else path.removeprefix('/')
        if filename not in PUBLIC_FILES or (ROOT / filename).is_symlink():
            self.send_error(404, 'Not found')
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404, 'Directory listing disabled')
        return None

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--allow-subnet', action='append', default=[])
    args = parser.parse_args()
    networks = [ipaddress.ip_network('127.0.0.0/8')]
    networks.extend(ipaddress.ip_network(cidr) for cidr in args.allow_subnet)
    handler = partial(PreviewHandler, directory=str(ROOT))
    with ThreadingHTTPServer((args.host, args.port), handler) as server:
        server.allowed_networks = networks
        print(f'Family tree preview: http://{args.host}:{args.port}/', flush=True)
        print('Allowed networks: ' + ', '.join(map(str, networks)), flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
