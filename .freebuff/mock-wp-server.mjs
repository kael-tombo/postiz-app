// Minimal mock of the WordPress REST API for the post-lifecycle test.
// Records every received request so the suite can assert the Postiz worker
// actually called the provider. Serves on 127.0.0.1:4789.
import http from 'node:http';

const received = [];

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    received.push({
      method: req.method,
      url: req.url,
      auth: req.headers.authorization || '',
      body: body,
      at: new Date().toISOString(),
    });

    // Basic-auth protected WP REST endpoints used by the provider.
    if (req.url === '/wp-json/wp/v2/users/me') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 1,
        name: 'Mock WP Admin',
        avatar_urls: { 96: 'http://127.0.0.1:4789/avatar.png' },
      }));
      return;
    }

    if (req.url === '/wp-json/wp/v2/posts' && req.method === 'POST') {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: Math.floor(Math.random() * 100000),
        link: `http://127.0.0.1:4789/?p=${Math.floor(Math.random() * 100000)}`,
      }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 'not_found', message: 'mock: no route' }));
  });
});

server.listen(4789, '127.0.0.1', () => {
  console.log('MOCK-WP-LISTENING');
});

// Signal the recorded requests to a poller via a JSON file (simple, works
// across processes on Windows).
import fs from 'node:fs';
import path from 'node:path';
const dump = () => {
  try {
    fs.writeFileSync(
      path.resolve('.freebuff/mock-wp-received.json'),
      JSON.stringify(received, null, 1)
    );
  } catch {}
};
setInterval(dump, 500);
process.on('SIGINT', () => { dump(); process.exit(0); });
