// Local dev / self-hosted server. Serves public/ and the same JSON paths the static build writes:
//   /api/{schedule,results,news,highlights,standings,players}.json
//   /api/boxscore/<league>/<comp or _>/<event>.json
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config, ROOT, schedule, results, boxscore, news, highlights, standings, players, refreshSnapshots } from './api.js';

const PORT = Number(process.env.PORT ?? config.port ?? 3000);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const routes = { schedule, results, news, highlights, standings, players };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.normalize(path.join(ROOT, 'public', rel));
  if (!file.startsWith(path.join(ROOT, 'public'))) return send(res, 403, { error: 'forbidden' });
  try {
    send(res, 200, await readFile(file), MIME[path.extname(file)] ?? 'application/octet-stream');
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    let m = url.pathname.match(/^\/api\/boxscore\/([\w.-]+)\/([\w.-]+)\/(\d+)\.json$/);
    if (m) return send(res, 200, await boxscore(m[1], m[2], m[3]));
    m = url.pathname.match(/^\/api\/(\w+)\.json$/);
    if (m) {
      if (!routes[m[1]]) return send(res, 404, { error: 'unknown endpoint' });
      return send(res, 200, { ...(await routes[m[1]]()), builtAt: new Date().toISOString() });
    }
    return serveStatic(res, url.pathname);
  } catch (err) {
    if (!err.status) console.error(`[${req.method} ${url.pathname}]`, err);
    send(res, err.status ?? 502, { error: err.message });
  }
});

refreshSnapshots();
setInterval(refreshSnapshots, 15 * 60 * 1000);
server.listen(PORT, () => console.log(`splash-sports running at http://localhost:${PORT}`));
