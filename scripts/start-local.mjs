import { spawn, execFile } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { selectLanAddress } from './local-network.mjs';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const serverPath = resolve(root, 'server.mjs');

async function commandOutput(binary, args) {
  try {
    const { stdout } = await execFileAsync(binary, args, { timeout: 5000, maxBuffer: 2 * 1024 * 1024 });
    return stdout;
  } catch {
    return '';
  }
}

async function currentLanAddress() {
  const [route, table] = await Promise.all([
    commandOutput('/sbin/route', ['-n', 'get', 'default']),
    commandOutput('/usr/sbin/netstat', ['-rn', '-f', 'inet'])
  ]);
  return selectLanAddress(route, table, networkInterfaces());
}

export function bonjourRegistrationReady(output) {
  const record = /Got a reply for record ([^:\r\n]+): Name now registered and active/i.exec(output)?.[1];
  const service = /Got a reply for service ([^\r\n]+?)\._https\._tcp\.local\.?: Name now registered and active/i.exec(output)?.[1];
  if (record && record !== 'reader.local') {
    throw new Error(`Bonjour renamed reader.local to ${record}; resolve the hostname conflict.`);
  }
  if (service && service !== "Richard's Reader") {
    throw new Error(`Bonjour renamed the service to ${service}; stop the competing registration.`);
  }
  return Boolean(record && service);
}

function waitForText(child, matcher, name, timeoutMs = 10000) {
  return new Promise((resolveReady, rejectReady) => {
    let captured = '';
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      child.stderr?.off('data', onData);
      child.off('error', onError);
      child.off('exit', onExit);
    };
    const onData = chunk => {
      captured = (captured + chunk.toString()).slice(-4096);
      try {
        const ready = typeof matcher === 'function' ? matcher(captured) : matcher.test(captured);
        if (ready) { cleanup(); resolveReady(); }
      } catch (error) { cleanup(); rejectReady(error); }
    };
    const onError = error => { cleanup(); rejectReady(new Error(`${name} failed: ${error.message}`)); };
    const onExit = (code, signal) => {
      cleanup();
      rejectReady(new Error(`${name} exited before readiness (${signal || code}). ${captured.trim()}`));
    };
    const timer = setTimeout(() => {
      cleanup(); rejectReady(new Error(`${name} did not become ready within ${timeoutMs / 1000} seconds. ${captured.trim()}`));
    }, timeoutMs);
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

async function waitForHealth(port, server) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error('Reader server exited before its health check completed.');
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
      if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
        await response.body?.cancel();
        return;
      }
      await response.body?.cancel();
    } catch { /* Wait for the new server to accept connections. */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error('Reader server did not pass its local health check.');
}

function startChild(binary, args, options) {
  const child = spawn(binary, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
  return child;
}

async function terminate(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolveStopped => {
    let timer, forceTimer, settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceTimer);
      resolveStopped();
    };
    child.once('exit', done);
    child.once('error', done);
    child.once('close', done);
    timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* Already gone. */ }
      forceTimer = setTimeout(done, 1000);
    }, 3000);
    try { if (!child.kill('SIGTERM')) done(); } catch { done(); }
  });
}

export async function stopChildren(advertisement, server) {
  // Remove the address record first so a stopped Reader is not advertised.
  await terminate(advertisement);
  await terminate(server);
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('Automatic reader.local registration currently requires macOS and dns-sd.');
  }
  if (process.getuid?.() === 0) {
    throw new Error('Run Reader as your normal user, without sudo.');
  }
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('PORT must be an unprivileged integer between 1024 and 65535.');
  }
  const { interfaceName, address } = await currentLanAddress();
  let server, advertisement, stopping;
  const stop = (code = 0) => {
    if (stopping) return stopping;
    stopping = stopChildren(advertisement, server).then(() => { process.exitCode = code; });
    return stopping;
  };
  const interrupted = () => { void stop(0); };
  process.on('SIGINT', interrupted);
  process.on('SIGTERM', interrupted);
  process.on('exit', () => {
    // Final synchronous safeguard if Node exits through an unexpected path.
    if (advertisement?.exitCode === null && advertisement.signalCode === null) advertisement.kill('SIGTERM');
    if (server?.exitCode === null && server.signalCode === null) server.kill('SIGTERM');
  });
  try {
    server = startChild(process.execPath, [serverPath], {
      cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) }
    });
    server.once('exit', () => { if (!stopping) void stop(1); });
    await waitForText(server, /Reader app files listening on /, 'Reader server');
    await waitForHealth(port, server);
    if (stopping) return;
    advertisement = startChild('/usr/bin/dns-sd', [
      '-P', "Richard's Reader", '_https._tcp', 'local', '443', 'reader.local', address
    ], { cwd: root });
    advertisement.once('exit', () => { if (!stopping) void stop(1); });
    await waitForText(advertisement, bonjourRegistrationReady, 'Bonjour registration');
    if (stopping) return;
    process.stdout.write(`\nRichard's Reader running (${interfaceName})\n` +
      `Application server: http://127.0.0.1:${port} (loopback only)\n` +
      `Reader:  https://reader.local/ (Caddy on this Mac)\n` +
      'Press Ctrl-C to stop the server and Bonjour advertisement.\n');
  } catch (error) {
    process.stderr.write(`Reader startup failed: ${error.message}\n`);
    await stop(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
