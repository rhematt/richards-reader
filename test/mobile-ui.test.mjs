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
const production = process.env.READER_TEST_PRODUCTION === '1';
const port = production ? 5190 : 5189;

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
    await this.call('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 1 });
    await until(() => this.evaluate('document.readyState === "complete" && !!document.querySelector("#reader-scroll")'));
    await this.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
  }
  async file(path) {
    const { root } = await this.call('DOM.getDocument');
    const { nodeId } = await this.call('DOM.querySelector', { nodeId: root.nodeId, selector: '#file-input' });
    await this.call('DOM.setFileInputFiles', { nodeId, files: [path] });
    await until(() => this.evaluate('document.querySelectorAll("#reader-content .block").length > 0'));
  }
}

test('MOBILE-001..010: phone surfaces, options, source drawer, ruler and tablet regression', { timeout: 120000, skip: !existsSync(edge) && 'Set READER_TEST_BROWSER to an installed Chromium/Edge executable' }, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'reader-mobile-test-'));
  const ordinary = join(temp, 'ordinary.pdf');
  const complex = join(temp, 'complex.pdf');
  await writeFile(ordinary, ordinaryPdf());
  await writeFile(complex, figureAndTablePdf());
  const server = spawn(process.execPath, production ? ['server.mjs'] : ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: process.cwd(), stdio: 'ignore', env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) }
  });
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
          original: visible('mobile-original-button'), menu: visible('mobile-menu-button'), settings: visible('mobile-settings-button'), play: visible('speak-button'),
          previous: visible('previous-sentence'), next: visible('next-sentence'), speed: visible('speech-rate'), search: visible('search-input'),
          touchHeights: ['mobile-original-button','mobile-menu-button','mobile-settings-button','speak-button','previous-sentence','next-sentence','speech-rate','search-input','heading-select'].map(id => document.getElementById(id)?.getBoundingClientRect().height || 0) };
      })()`);
      assert.ok(layout.readerWidth >= width - 2, `${width}×${height}: reading pane fills the phone`);
      assert.ok(layout.sourceWidth === 0, `${width}×${height}: no permanent original pane`);
      assert.ok(layout.appWidth <= layout.viewportWidth + 1, `${width}×${height}: no application horizontal scroll`);
      for (const key of ['original', 'menu', 'settings', 'play', 'previous', 'next', 'speed', 'search']) assert.ok(layout[key], `${width}×${height}: ${key} is available`);
      assert.ok(layout.touchHeights.every(height => height >= 43), `${width}×${height}: primary controls are at least 44 CSS pixels high`);
    }

    await cdp.viewport(390, 844);
    await cdp.file(ordinary);
    await cdp.evaluate(`document.querySelector('#mobile-menu-button').click()`);
    assert.ok(await cdp.evaluate(`!document.querySelector('#mobile-menu').hidden && document.querySelector('#mobile-menu-button').getAttribute('aria-expanded') === 'true'`), 'MOBILE-010: top menu opens');
    await cdp.evaluate(`document.querySelector('#mobile-menu-settings').click()`);
    assert.ok(await cdp.evaluate(`document.querySelector('#mobile-menu').hidden && !document.querySelector('#settings-panel').hidden && !!document.querySelector('#font-family') && !!document.querySelector('#background-color') && !!document.querySelector('#ruler-mode') && !!document.querySelector('#citation-view') && !!document.querySelector('#saved-profiles') && !!document.querySelector('#mobile-voice-select')`), 'MOBILE-010: menu opens the full reading settings sheet');
    await cdp.evaluate(`document.querySelector('#settings-close').click()`);
    if (process.env.READER_TEST_SCREENSHOT) {
      const { data } = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await writeFile(process.env.READER_TEST_SCREENSHOT, Buffer.from(data, 'base64'));
    }
    await cdp.evaluate(`document.querySelector('#reader-scroll').scrollTop = 100`);
    const initialTop = await cdp.evaluate('document.querySelector("#reader-scroll").scrollTop');
    await cdp.evaluate(`document.querySelector('#reader-content .block').click(); document.querySelector('#mobile-original-button').click()`);
    const drawer = await cdp.evaluate(`(() => ({ open: document.body.classList.contains('mobile-original-open'), highlight: !!document.querySelector('.source-highlight'), source: document.querySelector('#source-pane').getBoundingClientRect().width }))()`);
    assert.ok(drawer.open && drawer.source >= 389 && drawer.highlight, 'MOBILE-003: drawer shows the selected source box');
    await until(() => cdp.evaluate('!!document.querySelector("#source-content canvas")'));
    if (process.env.READER_TEST_DRAWER_SCREENSHOT) {
      const { data } = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await writeFile(process.env.READER_TEST_DRAWER_SCREENSHOT, Buffer.from(data, 'base64'));
    }
    const zoomBefore = await cdp.evaluate('document.querySelector("#mobile-zoom-value").textContent');
    await cdp.evaluate('document.querySelector("#mobile-zoom-in").click()');
    assert.notEqual(await cdp.evaluate('document.querySelector("#mobile-zoom-value").textContent'), zoomBefore, 'MOBILE-003: drawer zoom works');
    await cdp.evaluate(`document.querySelector('#mobile-original-close').click()`);
    assert.equal(await cdp.evaluate('document.querySelector("#reader-scroll").scrollTop'), initialTop, 'MOBILE-003: closing preserves reading position');
    await cdp.evaluate(`document.querySelector('#search-input').value = 'Paragraph'; document.querySelector('#search-input').dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#search-next').click()`);
    assert.ok(await cdp.evaluate(`!!document.querySelector('.block.search-current.selected') && !!document.querySelector('.source-highlight')`), 'MOBILE-002: search retains accessible and source linkage');

    await cdp.evaluate(`document.querySelector('#ruler-mode').value = 'line'; document.querySelector('#ruler-mode').dispatchEvent(new Event('change', { bubbles: true }))`);
    const ruler = await cdp.evaluate(`(() => { const node = document.querySelector('#ruler'); return { position: getComputedStyle(node).position, top: node.getBoundingClientRect().top, grip: !!document.querySelector('#ruler-grip') } })()`);
    assert.equal(ruler.position, 'fixed', 'MOBILE-004: ruler is a viewport overlay');
    assert.ok(ruler.grip, 'MOBILE-004: ruler has a separate grip');
    await cdp.evaluate(`document.querySelector('#reader-scroll').scrollTop += 80`);
    const afterScroll = await cdp.evaluate('document.querySelector("#ruler").getBoundingClientRect().top');
    assert.ok(Math.abs(afterScroll - ruler.top) <= 1, 'MOBILE-004: document scroll does not move ruler');
    const beforeGrip = await cdp.evaluate(`(() => { const grip = document.querySelector('#ruler-grip').getBoundingClientRect(); return { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2, scroll: document.querySelector('#reader-scroll').scrollTop }; })()`);
    await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: beforeGrip.x, y: beforeGrip.y, button: 'left', clickCount: 1 });
    await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: beforeGrip.x, y: beforeGrip.y + 45, button: 'left', buttons: 1 });
    await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: beforeGrip.x, y: beforeGrip.y + 45, button: 'left', clickCount: 1 });
    const afterGrip = await cdp.evaluate(`({ top: document.querySelector('#ruler').getBoundingClientRect().top, scroll: document.querySelector('#reader-scroll').scrollTop })`);
    assert.ok(afterGrip.top > afterScroll + 30, 'MOBILE-004: dragging grip moves ruler');
    assert.equal(afterGrip.scroll, beforeGrip.scroll, 'MOBILE-004: dragging grip does not scroll document');
    const touchGrip = await cdp.evaluate(`(() => { const rect = document.querySelector('#ruler-grip').getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, top: document.querySelector('#ruler').getBoundingClientRect().top, scroll: document.querySelector('#reader-scroll').scrollTop }; })()`);
    await cdp.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchGrip.x, y: touchGrip.y, id: 1 }] });
    await cdp.call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchGrip.x, y: touchGrip.y + 30, id: 1 }] });
    await cdp.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const touchResult = await cdp.evaluate(`({ top: document.querySelector('#ruler').getBoundingClientRect().top, scroll: document.querySelector('#reader-scroll').scrollTop })`);
    assert.ok(touchResult.top > touchGrip.top + 15, 'MOBILE-004: touch drag moves grip');
    assert.equal(touchResult.scroll, touchGrip.scroll, 'MOBILE-004: touch grip does not scroll document');

    await cdp.evaluate(`document.querySelector('#mobile-settings-button').click()`);
    assert.ok(await cdp.evaluate(`!document.querySelector('#settings-panel').hidden && document.querySelector('#reader-pane').getBoundingClientRect().width >= 389`), 'MOBILE-007: settings sheet leaves reading width intact');
    await cdp.evaluate(`(() => { const size = document.querySelector('#font-size'); size.value = '23'; size.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('#profile-name').value = 'Mobile test'; document.querySelector('#save-profile').click(); size.value = '19'; size.dispatchEvent(new Event('change', { bubbles: true })); const profiles = document.querySelector('#saved-profiles'); profiles.value = 'Mobile test'; profiles.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    assert.equal(await cdp.evaluate('document.querySelector("#font-size").value'), '23', 'MOBILE-007: saved profile restores typography');
    await cdp.evaluate(`document.querySelector('#settings-close').click()`);
    assert.ok(await cdp.evaluate(`document.querySelector('#settings-panel').hidden`), 'MOBILE-007: settings closes');

    await cdp.file(complex);
    await until(() => cdp.evaluate('!!document.querySelector(".block[data-type=\'image\'],.block[data-type=\'table\']")'));
    await cdp.evaluate(`document.querySelector('.block[data-type="image"]')?.scrollIntoView()`);
    await until(() => cdp.evaluate('document.querySelector(".block[data-type=\'image\'] img")?.src.startsWith("data:image/png")'));
    const sourceBlock = await cdp.evaluate(`(() => { const block = document.querySelector('.block[data-type="image"],.block[data-type="table"]'); block?.querySelector('.source-page-link')?.click(); return { found: !!block, open: document.body.classList.contains('mobile-original-open'), highlight: !!document.querySelector('.source-highlight') }; })()`);
    assert.ok(sourceBlock.found && sourceBlock.open && sourceBlock.highlight, 'MOBILE-006: complex source link opens highlighted original');
    const complexTop = await cdp.evaluate('document.querySelector("#reader-scroll").scrollTop');
    await cdp.evaluate(`document.querySelector('#mobile-original-close').click()`);
    assert.equal(await cdp.evaluate('document.querySelector("#reader-scroll").scrollTop'), complexTop, 'MOBILE-006: source inspection returns to reading position');
    await cdp.evaluate(`document.querySelector('#mobile-original-button').click()`);
    await cdp.evaluate(`(() => { const box = document.querySelector('.source-highlight').getBoundingClientRect(); const shell = document.querySelector('.source-highlight').closest('.page-shell'); shell.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 })); })()`);
    assert.ok(await cdp.evaluate(`!document.body.classList.contains('mobile-original-open') && !!document.querySelector('.block.selected')`), 'MOBILE-003: selecting source returns to the linked accessible block');
    await cdp.viewport(844, 390);
    assert.ok(await cdp.evaluate(`document.querySelector('#reader-pane').getBoundingClientRect().width >= 843 && document.documentElement.scrollWidth <= innerWidth + 1`), 'MOBILE-008: loaded PDF remains usable in landscape');

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
