import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

// This process only reads built application files. It never accepts a request body.
if (process.getuid?.() === 0) {
  process.stderr.write('Run Reader as your normal user, without sudo.\n');
  process.exit(1);
}
const root = resolve('dist');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '0.0.0.0';
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.mjs': 'text/javascript; charset=utf-8'
};
function requestedOrigin(requestUrl) {
  try {
    const route = new URL(requestUrl, 'http://reader.local');
    const target = route.searchParams.get('url') || (/^\/https?:\/\//i.test(route.pathname) ? decodeURIComponent(route.pathname.slice(1)) : null);
    if (!target) return null;
    const url = new URL(target);
    return ['https:', 'http:'].includes(url.protocol) ? url.origin : null;
  } catch { return null; }
}
function contentSecurityPolicy(origin) {
  return [
    "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    "font-src 'self'", "img-src 'self' data: blob:",
    `connect-src ${origin ? `'self' ${origin}` : "'none'"}`,
    "worker-src 'self' blob:", `frame-src ${origin || "'none'"}`,
    "base-uri 'none'", "form-action 'self'", "object-src 'none'"
  ].join('; ');
}

createServer(async (request, response) => {
  response.setHeader('Content-Security-Policy', contentSecurityPolicy(requestedOrigin(request.url)));
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
  }
  let pathname;
  try { pathname = new URL(request.url, 'http://reader.local').pathname; }
  catch { response.writeHead(400); response.end(); return; }
  const assetPath = resolve(root, '.' + pathname);
  const inside = assetPath === root || assetPath.startsWith(root + sep);
  const isHidden = pathname.split('/').some(part => part.startsWith('.') && part !== '.');
  if (!inside || isHidden) { response.writeHead(404); response.end(); return; }
  let file = assetPath;
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
  } catch {
    if (pathname !== '/' && !/^\/https?:\/\//i.test(pathname)) { response.writeHead(404); response.end(); return; }
    file = resolve(root, 'index.html');
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch { response.writeHead(404); response.end(); }
}).listen(port, host, () => {
  process.stdout.write(`Reader app files listening on http://${host}:${port}\n`);
});
