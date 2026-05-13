const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3456;
const ROOT = __dirname;
const QUEUE_FILE = path.join(ROOT, 'chat_queue.json');
const RESP_FILE = path.join(ROOT, 'chat_response.json');

// ============================================================
// SSE clients registry
// ============================================================
let sseClients = [];

function broadcast(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(c => {
    try { c.write(payload); } catch (_) {}
  });
}

// ============================================================
// MIME types for static files
// ============================================================
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

// ============================================================
// HTTP Server
// ============================================================
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // --- SSE endpoint ---
  if (url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(':ok\n\n');
    sseClients.push(res);
    req.on('close', () => {
      sseClients = sseClients.filter(c => c !== res);
    });
    return;
  }

  // --- POST /chat — receive message from browser, write queue ---
  if (url.pathname === '/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const msg = JSON.parse(body);
        msg.id = Date.now().toString();
        msg.timestamp = new Date().toISOString();
        // Write queue — Monitor picks this up
        fs.writeFileSync(QUEUE_FILE, JSON.stringify(msg, null, 2), 'utf-8');
        // Touch a trigger file so file-watchers have a distinct event
        fs.writeFileSync(QUEUE_FILE + '.trigger', msg.id, 'utf-8');
        // Push "thinking" status to SSE
        broadcast({ type: 'thinking', id: msg.id, message: 'Claude Code 正在处理...' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'queued', id: msg.id }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // --- GET /response/:id — poll for response (fallback if SSE fails) ---
  if (url.pathname.startsWith('/response/') && req.method === 'GET') {
    const msgId = url.pathname.split('/').pop();
    try {
      if (fs.existsSync(RESP_FILE)) {
        const resp = JSON.parse(fs.readFileSync(RESP_FILE, 'utf-8'));
        if (resp.id === msgId) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(resp));
          return;
        }
      }
      res.writeHead(204);
      res.end();
    } catch (_) {
      res.writeHead(204);
      res.end();
    }
    return;
  }

  // --- Static file serving ---
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = path.join(ROOT, filePath);

  // Security: prevent directory traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// ============================================================
// Response file watcher — when Claude Code writes a response,
// push it to all connected SSE clients
// ============================================================
let lastRespMtime = 0;
setInterval(() => {
  try {
    if (!fs.existsSync(RESP_FILE)) return;
    const stat = fs.statSync(RESP_FILE);
    if (stat.mtimeMs <= lastRespMtime) return;
    lastRespMtime = stat.mtimeMs;

    const resp = JSON.parse(fs.readFileSync(RESP_FILE, 'utf-8'));
    broadcast({ type: 'response', ...resp });
  } catch (_) { /* file not ready yet */ }
}, 300);

server.listen(PORT, () => {
  console.log(`Bridge server running at http://localhost:${PORT}`);
  console.log(`Queue file: ${QUEUE_FILE}`);
  console.log(`Response file: ${RESP_FILE}`);
  console.log('');
  console.log('Waiting for chat messages...');
});
