const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const port = Number(process.env.ONDO_REVIEW_PORT || 4173);
const root = path.join(__dirname, '..');
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:' + port);
  if (url.pathname !== '/' && url.pathname !== '/index.html') {
    res.writeHead(404); res.end('Not found'); return;
  }
  let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const config = /API_URL:\s*'[^']*'/g;
  if ((html.match(config) || []).length !== 1) { res.writeHead(500); res.end('設定箇所が一意ではありません'); return; }
  html = html.replace(config, "API_URL: ''");
  html = html.replace(/<link\b[^>]*>/g, '');
  // ローカルデモのみ。音声・外部通信・本番APIは利用しません。
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; media-src 'none'; img-src 'self' data: blob:; font-src 'none'",
    'Permissions-Policy': 'microphone=(), camera=()'
  });
  res.end(html);
});
server.listen(port, '127.0.0.1', () => console.log('確認用デモ: http://127.0.0.1:' + port + ' （本番API通信なし）'));
