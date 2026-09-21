import functools
import importlib.util
import ipaddress
import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('serve_lan', ROOT / 'scripts/serve_lan.py')
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


class PreviewTests(unittest.TestCase):
    def setUp(self):
        handler = functools.partial(preview.PreviewHandler, directory=str(ROOT))
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        self.server.allowed_networks = [ipaddress.ip_network('127.0.0.0/8')]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'
        self.client = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_public_assets_are_served(self):
        with self.client.open(self.base + '/family-data.json') as response:
            self.assertEqual(json.load(response)['schemaVersion'], 3)
        for path in ('/', '/index.html', '/family-tree.html', '/family-tree.css', '/family-tree.js'):
            with self.client.open(self.base + path) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.headers['Cache-Control'], 'no-cache')
                if path in ('/', '/index.html'):
                    html = response.read().decode()
                    self.assertIn('id="tree-content"', html)
                    self.assertNotIn('http-equiv="refresh"', html)
                elif path == '/family-tree.html':
                    html = response.read().decode()
                    self.assertIn('url=index.html', html)
                    self.assertIn('location.search + location.hash', html)

    def test_questions_and_repository_files_cannot_be_downloaded(self):
        for path in ('/FOLLOW-UP-QUESTIONS.md', '/MERGE-REVIEW.md', '/.git/config', '/data/family-data.original.json', '/PKM%20SIR%20FAMILY%20TYPING.csv', '/scripts/serve_lan.py', '/node_modules/', '/%46OLLOW-UP-QUESTIONS.md', '/../FOLLOW-UP-QUESTIONS.md'):
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.client.open(self.base + path)
            self.assertEqual(error.exception.code, 404)

    def test_only_allowed_subnet_can_read(self):
        self.server.allowed_networks = [ipaddress.ip_network('192.168.1.0/24')]
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.client.open(self.base + '/index.html')
        self.assertEqual(error.exception.code, 403)


if __name__ == '__main__':
    unittest.main()
