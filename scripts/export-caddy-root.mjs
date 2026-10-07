import { get } from 'node:http';
import { X509Certificate } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const output = process.argv[2] || 'reader-local-root.crt';
const chain = await new Promise((resolve, reject) => {
  get('http://127.0.0.1:2019/pki/ca/local/certificates', response => {
    if (response.statusCode !== 200) { response.resume(); reject(new Error(`Caddy admin API returned ${response.statusCode}`)); return; }
    let body = '';
    response.setEncoding('utf8');
    response.on('data', chunk => { body += chunk; if (body.length > 50000) response.destroy(new Error('Unexpectedly large CA response')); });
    response.on('end', () => resolve(body));
    response.on('error', reject);
  }).on('error', reject);
});
const certificates = [...chain.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)].map(match => match[0]);
const root = certificates.find(pem => {
  const certificate = new X509Certificate(pem);
  return certificate.subject === certificate.issuer && certificate.ca;
});
if (!root) throw new Error('Caddy did not return a self-signed root CA');
const certificate = new X509Certificate(root);
await writeFile(output, `${root}\n`, { mode: 0o644 });
process.stdout.write(`Saved public Caddy root to ${output}\nSHA-256 ${certificate.fingerprint256}\n`);
