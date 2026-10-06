import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ordinaryPdf, figureAndTablePdf } from './pdf-fixture.mjs';

const edge = process.env.READER_TEST_BROWSER || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
const port = 5189;

async function until(check, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const result = await check(); if (result) return result; } catch { /* start-up race */ }
    await delay(100);
  }
  throw new Error('Timed out waiting for browser or Reader');
}

class DevTools {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const task = this.pending.get(message.id);
      if (!task) return;
      this.pending.delete(message.id);
      message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result);
    });
  }
  call(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  async viewport(width, height, mobile = true) {
    await this.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height });
    await this.call('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 1 : 0 });
    await this.call('Page.reload', { ignoreCache: true });
    await until(() => this.evaluate('document.readyState === "complete" && !!document.querySelector("#reader-scroll")'));
  }
  async file(path) {
    const { root } = await this.call('DOM.getDocument');
    const { nodeId } = await this.call('DOM.querySelector', { nodeId: root.nodeId, selector: '#file-input' });
    await this.call('DOM.setFileInputFiles', { nodeId, files: [path] });
    await until(() => this.evaluate('document.querySelectorAll("#reader-content .block").length > 0'));
  }
}

test('MOBILE-001..009: phone surfaces, source drawer, ruler and tablet regression', { timeout: 120000, skip: !existsSync(edge) && 'Set READER_TEST_BROWSER to an installed Chromium/Edge executable' }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'reader-mobile-test-'));
  const ordinary = join(temp, 'ordinary.pdf');
  const complex = join(temp, 'complex.pdf');
  await writeFile(ordinary, ordinaryPdf());
  await writeFile(complex, figureAndTablePdf());
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: process.cwd(), stdio: 'ignore' });
  let browser;
  let cdp;
  try {
    await until(async () => (await fetch(`http://127.0.0.1:${port}/`)).ok);
    browser = spawn(edge, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${temp}`, `http://127.0.0.1:${port}/`], { stdio: 'ignore' });
    const debugPort = Number((await until(async () => (await readFile(join(temp, 'DevToolsActivePort'), 'utf8')).split('\n')[0])).trim());
    const tab = await until(async () => (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(item => item.type === 'page' && item.url.includes(String(port))));
    const socket = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    cdp = new DevTools(socket);
    await cdp.call('Page.enable');
    await cdp.call('Runtime.enable');

    for (const [width, height] of [[390, 844], [430, 932], [844, 390], [932, 430]]) {
      await cdp.viewport(width, height);
      const layout = await cdp.evaluate(`(() => {
        const reader = document.querySelector('#reader-pane').getBoundingClientRect();
        const source = document.querySelector('#source-pane').getBoundingClientRect();
        const visible = id => { const node = document.getElementById(id); return !!node && getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().width > 0; };
        return { readerWidth: reader.width, sourceWidth: source.width, appWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
          original: visible('mobile-original-button'), settings: visible('mobile-settings-button'), play: visible('speak-button'),
          previous: visible('previous-sentence'), next: visible('next-sentence'), speed: visible('speech-rate'), search: visible('search-input') };
      })()`);
      assert.ok(layout.readerWidth >= width - 2, `${width}×${height}: reading pane fills the phone`);
      assert.ok(layout.sourceWidth === 0, `${width}×${height}: no permanent original pane`);
      assert.ok(layout.appWidth <= layout.viewportWidth + 1, `${width}×${height}: no application horizontal scroll`);
      for (const key of ['original', 'settings', 'play', 'previous', 'next', 'speed', 'search']) assert.ok(layout[key], `${width}×${height}: ${key} is available`);
    }

    await cdp.viewport(390, 844);
    await cdp.file(ordinary);
    await cdp.evaluate(`document.querySelector('#reader-scroll').scrollTop = 100`);
    const initialTop = await cdp.evaluate('document.querySelector("#reader-scroll").scrollTop');
    await cdp.evaluate(`document.querySelector('#reader-content .block').click(); document.querySelector('#mobile-original-button').click()`);
    const drawer = await cdp.evaluate(`(() => ({ open: document.body.classList.contains('mobile-original-open'), highlight: !!document.querySelector('.source-highlight'), source: document.querySelector('#source-pane').getBoundingClientRect().width }))()`);
    assert.ok(drawer.open && drawer.source >= 389 && drawer.highlight, 'MOBILE-003: drawer shows the selected source box');
    await cdp.evaluate(`document.querySelector('#mobile-original-close').click()`);
    assert.equal(await cdp.evaluate('document.querySelector("#reader-scroll").scrollTop'), initialTop, 'MOBILE-003: closing preserves reading position');

    await cdp.evaluate(`document.querySelector('#ruler-mode').value = 'line'; document.querySelector('#ruler-mode').dispatchEvent(new Event('change', { bubbles: true }))`);
    const ruler = await cdp.evaluate(`(() => { const node = document.querySelector('#ruler'); return { position: getComputedStyle(node).position, top: node.getBoundingClientRect().top, grip: !!document.querySelector('#ruler-grip') } })()`);
    assert.equal(ruler.position, 'fixed', 'MOBILE-004: ruler is a viewport overlay');
    assert.ok(ruler.grip, 'MOBILE-004: ruler has a separate grip');
    await cdp.evaluate(`document.querySelector('#reader-scroll').scrollTop += 80`);
    const afterScroll = await cdp.evaluate('document.querySelector("#ruler").getBoundingClientRect().top');
    assert.ok(Math.abs(afterScroll - ruler.top) <= 1, 'MOBILE-004: document scroll does not move ruler');

    await cdp.file(complex);
    const sourceBlock = await cdp.evaluate(`(() => { const block = document.querySelector('.block[data-type="image"],.block[data-type="table"]'); block?.querySelector('.source-page-link')?.click(); return { found: !!block, open: document.body.classList.contains('mobile-original-open'), highlight: !!document.querySelector('.source-highlight') }; })()`);
    assert.ok(sourceBlock.found && sourceBlock.open && sourceBlock.highlight, 'MOBILE-006: complex source link opens highlighted original');

    await cdp.viewport(768, 1024);
    const tablet = await cdp.evaluate(`(() => ({ source: document.querySelector('#source-pane').getBoundingClientRect().width, reader: document.querySelector('#reader-pane').getBoundingClientRect().width }))()`);
    assert.ok(tablet.source > 200 && tablet.reader > 200, 'MOBILE-009: iPad portrait keeps dual panes');
    await cdp.viewport(1280, 800, false);
    const desktop = await cdp.evaluate(`(() => ({ source: document.querySelector('#source-pane').getBoundingClientRect().width, reader: document.querySelector('#reader-pane').getBoundingClientRect().width }))()`);
    assert.ok(desktop.source > 400 && desktop.reader > 400, 'MOBILE-009: desktop keeps dual panes');
  } finally {
    cdp?.socket.close();
    if (browser && browser.exitCode == null) { browser.kill('SIGTERM'); await Promise.race([once(browser, 'exit'), delay(3000)]); }
    if (server.exitCode == null) { server.kill('SIGTERM'); await Promise.race([once(server, 'exit'), delay(3000)]); }
    await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
