import http from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve('dist'), port = Number(process.env.PORT || 4393);
// every response carries the site-wide headers the host sends (the "/*" block of _headers), so local
// and ci browser runs are held to the live content security policy, not a laxer one
const site = {};
let inBlock = false;
for (const line of readFileSync(resolve(root, '_headers'), 'utf8').split('\n')) {
  if (!/^\s/.test(line)) { inBlock = line.trim() === '/*'; continue; }
  const at = line.indexOf(':');
  if (inBlock && at > 0) site[line.slice(0, at).trim()] = line.slice(at + 1).trim();
}
if (!site['Content-Security-Policy']) throw new Error('dist/_headers: no site-wide Content-Security-Policy');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
http.createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path === '/_headers' || path.startsWith('/.')) { res.writeHead(404).end(); return; }
    const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
    if (!file.startsWith(root + '/')) { res.writeHead(403).end(); return; }
    const data = await readFile(file); res.writeHead(200, { ...site, 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(data);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`jailbirds: http://127.0.0.1:${port}`));
