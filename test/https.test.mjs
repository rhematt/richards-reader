import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('HTTPS-001..003/008/009: canonical LAN entry is Caddy internal TLS to loopback Reader', async () => {
  const caddy = await readFile(new URL('../deploy/Caddyfile.example', import.meta.url), 'utf8');
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(caddy, /^reader\.local\s*\{/m);
  assert.match(caddy, /tls\s+internal/);
  assert.match(caddy, /reverse_proxy\s+127\.0\.0\.1:4173/);
  assert.doesNotMatch(caddy, /(^|\s)(acme|reverse_proxy\s+https?:\/\/[^\s]*\.[^\s]*)(\s|$)/);
  assert.match(server, /import\s+\{\s*createServer\s*\}\s+from\s+'node:http'/);
  assert.match(server, /process\.env\.HOST\s*\|\|\s*'127\.0\.0\.1'/);
  assert.match(server, /\['GET', 'HEAD'\]/);
  assert.match(readme, /https:\/\/reader\.local\//);
  assert.match(readme, /Certificate\s+Trust Settings/);
  assert.match(readme, /pki\/ca\/local\/certificates/);
});
