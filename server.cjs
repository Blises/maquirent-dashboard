const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT || 4177);
http.createServer((req, res) => {
  let name;
  try { name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch (_) { res.writeHead(400); return res.end(); }
  if (name === '/') name = '/index.html';
  // Solo se sirve la interfaz; el repositorio y la configuración quedan fuera.
  if (name !== '/index.html' && !name.startsWith('/assets/')) { res.writeHead(404); return res.end(); }
  const file = path.resolve(root, '.' + name);
  if (file !== path.join(root, 'index.html') && !file.startsWith(path.join(root, 'assets') + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (error, body) => {
    if (error) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  });
}).listen(port, '127.0.0.1', () => console.log(`MaquiRent: http://127.0.0.1:${port}`));
