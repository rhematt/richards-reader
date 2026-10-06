import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ordinaryPdf, figureAndTablePdf, v2HierarchyPdf } from './pdf-fixture.mjs';

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
    this.logs = [];
    this.network = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.consoleAPICalled') this.logs.push(message.params.args.map(arg => arg.value || arg.description).join(' '));
      if (message.method === 'Runtime.exceptionThrown') this.logs.push(message.params.exceptionDetails.text);
      if (message.method === 'Network.requestWillBeSent') this.network.push(message.params.request);
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
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
  const hierarchy = join(temp, 'hierarchy.pdf');
  await writeFile(ordinary, ordinaryPdf());
  await writeFile(complex, figureAndTablePdf());
  await writeFile(hierarchy, v2HierarchyPdf());
  const server = spawn(process.execPath, production ? ['server.mjs'] : ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: process.cwd(), stdio: 'ignore', env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) }
  });
  let browser;
  let cdp;
  try {
    await until(async () => (await fetch(`http://127.0.0.1:${port}/`)).ok);
    browser = spawn(edge, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${temp}`, `http://127.0.0.1:${port}/`], { stdio: process.env.READER_TEST_DEBUG ? 'inherit' : 'ignore' });
    const debugPort = Number((await until(async () => (await readFile(join(temp, 'DevToolsActivePort'), 'utf8')).split('\n')[0])).trim());
    const tab = await until(async () => (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(item => item.type === 'page' && item.url.includes(String(port))));
    const socket = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    cdp = new DevTools(socket);
    await cdp.call('Page.enable');
    await cdp.call('Runtime.enable');
    await cdp.call('Network.enable');

    for (const [width, height] of [[390, 844], [430, 932], [844, 390], [932, 430]]) {
      await cdp.viewport(width, height);
      const layout = await cdp.evaluate(`(() => {
        const reader = document.querySelector('#reader-pane').getBoundingClientRect();
        const source = document.querySelector('#source-pane').getBoundingClientRect();
        const visible = id => { const node = document.getElementById(id); return !!node && getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().width > 0; };
        return { readerWidth: reader.width, sourceWidth: source.width, appWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
          original: visible('mobile-original-button'), menu: visible('mobile-menu-button'), settings: visible('mobile-settings-button'), play: visible('speak-button'),
          previous: visible('previous-sentence'), next: visible('next-sentence'), speed: visible('speech-rate'), search: visible('search-input'),
          touchHeights: ['mobile-original-button','mobile-menu-button','mobile-settings-button','speak-button','previous-sentence','next-sentence','speech-rate','search-input','outline-button'].map(id => document.getElementById(id)?.getBoundingClientRect().height || 0) };
      })()`);
      assert.ok(layout.readerWidth >= width - 2, `${width}×${height}: reading pane fills the phone`);
      assert.ok(layout.sourceWidth === 0, `${width}×${height}: no permanent original pane`);
      assert.ok(layout.appWidth <= layout.viewportWidth + 1, `${width}×${height}: no application horizontal scroll`);
      for (const key of ['original', 'menu', 'settings', 'play', 'previous', 'next', 'speed', 'search']) assert.ok(layout[key], `${width}×${height}: ${key} is available`);
      assert.ok(layout.touchHeights.every(height => height >= 43), `${width}×${height}: primary controls are at least 44 CSS pixels high`);
    }

    await cdp.viewport(390, 844);
    await cdp.file(ordinary);
    assert.ok(await cdp.evaluate(`getComputedStyle(document.querySelector('#review-mode-button')).display === 'none' && getComputedStyle(document.querySelector('#review-toolbar')).display === 'none' && !!document.querySelector('#mobile-menu-annotations')`), 'ANNOT-026: phone has annotation navigation without precision tools');
    const interactionBefore = await cdp.evaluate(`window.readerDiagnostics.interaction`);
    await cdp.evaluate(`(() => { const word = [...document.querySelectorAll('#reader-content .word')].find(node => node.textContent === 'Reader'); word.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })); word.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 })); word.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 })); })()`);
    await until(() => cdp.evaluate(`!document.querySelector('#dictionary-panel').hidden`));
    await delay(350);
    const interactionAfter = await cdp.evaluate(`window.readerDiagnostics.interaction`);
    assert.deepEqual(interactionAfter, interactionBefore, 'DICT-005..010: double-click definition does not change speech, source or ruler state');
    await cdp.evaluate(`document.querySelector('#dictionary-close').click()`);
    assert.deepEqual(await cdp.evaluate(`window.readerDiagnostics.interaction`), interactionBefore, 'DICT-012: closing definition leaves reading state unchanged');
    await cdp.evaluate(`[...document.querySelectorAll('#reader-content .sentence')].at(-2).dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))`);
    assert.equal((await cdp.evaluate(`window.readerDiagnostics.interaction`)).speechIndex, interactionBefore.speechIndex, 'DICT-004: first click waits for double-click window');
    await until(() => cdp.evaluate(`window.readerDiagnostics.interaction.speechIndex > ${interactionBefore.speechIndex}`));
    assert.ok(await cdp.evaluate(`window.readerDiagnostics.interaction.speaking || document.querySelector('#speak-button').disabled`), 'DICT-004: sentence click starts available device speech');
    await delay(350);
    const listening = await cdp.evaluate(`window.readerDiagnostics.interaction`);
    await cdp.evaluate(`(() => { const word = [...document.querySelectorAll('#reader-content .word')].find(node => node.textContent === 'source'); word.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })); word.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 })); word.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 })); })()`);
    await until(() => cdp.evaluate(`!document.querySelector('#dictionary-panel').hidden`));
    assert.deepEqual(await cdp.evaluate(`window.readerDiagnostics.interaction`), listening, 'DICT-006..010: dictionary lookup during speech leaves playback and anchors untouched');
    await cdp.evaluate(`document.querySelector('#dictionary-close').click(); if (window.readerDiagnostics.interaction.speaking) document.querySelector('#speak-button').click()`);
    await cdp.evaluate(`(() => { const block = [...document.querySelectorAll('#reader-content .block')].find(node => node.textContent.includes('Reader preserves')); block.click(); })()`);
    await until(() => cdp.evaluate(`!!document.querySelector('.source-highlight')`));
    await cdp.evaluate(`(() => { const block = [...document.querySelectorAll('#reader-content .block')].find(node => node.textContent.includes('Reader preserves')); const word = [...block.querySelectorAll('.word')].find(node => node.textContent === 'Reader'); const range = document.createRange(); range.selectNodeContents(word); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); })()`);
    await until(() => cdp.evaluate(`!document.querySelector('#define-button').hidden`));
    await cdp.evaluate(`document.querySelector('#define-button').click()`);
    await until(() => cdp.evaluate(`!document.querySelector('#dictionary-panel').hidden && document.querySelector('#dictionary-headword').textContent === 'reader'`));
    assert.ok(await cdp.evaluate(`!!document.querySelector('.source-highlight')`), 'DICT-003: definition does not clear the source anchor');
    await cdp.evaluate(`document.querySelector('#dictionary-close').click()`);
    await cdp.evaluate(`document.querySelector('#mobile-menu-button').click()`);
    assert.ok(await cdp.evaluate(`!document.querySelector('#mobile-menu').hidden && document.querySelector('#mobile-menu-button').getAttribute('aria-expanded') === 'true'`), 'MOBILE-010: top menu opens');
    await cdp.evaluate(`document.querySelector('#mobile-menu-settings').click()`);
    assert.ok(await cdp.evaluate(`document.querySelector('#mobile-menu').hidden && !document.querySelector('#settings-panel').hidden && !!document.querySelector('#font-family') && !!document.querySelector('#background-color') && !!document.querySelector('#ruler-mode') && !!document.querySelector('#citation-view') && !!document.querySelector('#saved-profiles') && !!document.querySelector('#mobile-voice-select')`), 'MOBILE-010: menu opens the full reading settings sheet');
    await cdp.evaluate(`document.querySelector('#settings-close').click()`);
    await cdp.evaluate(`document.querySelector('#reader-scroll').scrollTop = 100; document.querySelector('#mobile-menu-button').click(); document.querySelector('#mobile-menu-focus').click()`);
    assert.ok(await cdp.evaluate(`document.body.classList.contains('focus-mode') && document.querySelector('#focus-exit').getBoundingClientRect().width >= 44`), 'FOCUS-001: phone focus mode leaves a visible exit');
    const focusTop = await cdp.evaluate(`document.querySelector('#reader-scroll').scrollTop`);
    await cdp.evaluate(`document.querySelector('#focus-exit').click()`);
    assert.ok(await cdp.evaluate(`!document.body.classList.contains('focus-mode') && Math.abs(document.querySelector('#reader-scroll').scrollTop - ${focusTop}) < 2`), 'FOCUS-001: exit preserves reading position');
    assert.match(await cdp.evaluate(`document.querySelector('#reading-progress').textContent`), /\d+% · p\. 1\/1/, 'PROGRESS-001: logical progress and page are visible');
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
    assert.ok(await cdp.evaluate(`!document.querySelector('#source-ruler').hidden && !document.querySelector('#ruler').hidden`), 'RULER-001/002: both representations show a ruler');
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
    await cdp.evaluate(`document.querySelector('#mobile-original-button').click()`);
    const sourceRuler = await cdp.evaluate(`(() => { const ruler = document.querySelector('#source-ruler'); const source = document.querySelector('#source-scroll'); return { position: getComputedStyle(ruler).position, top: ruler.getBoundingClientRect().top, grip: !!document.querySelector('#source-ruler-grip'), scroll: source.scrollTop }; })()`);
    assert.equal(sourceRuler.position, 'fixed', 'RULER-009: mobile Original drawer uses a viewport ruler');
    assert.ok(sourceRuler.grip, 'RULER-009: source ruler has a touch grip');
    await cdp.evaluate(`document.querySelector('#source-scroll').scrollTop += 50`);
    assert.ok(Math.abs((await cdp.evaluate(`document.querySelector('#source-ruler').getBoundingClientRect().top`)) - sourceRuler.top) <= 1, 'RULER-005: PDF scrolling leaves source ruler in viewport');
    const sourceGrip = await cdp.evaluate(`(() => { const rect = document.querySelector('#source-ruler-grip').getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, scroll: document.querySelector('#source-scroll').scrollTop, readerTop: document.querySelector('#ruler').getBoundingClientRect().top }; })()`);
    await cdp.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sourceGrip.x, y: sourceGrip.y, id: 2 }] });
    await cdp.call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sourceGrip.x, y: sourceGrip.y + 32, id: 2 }] });
    await cdp.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const sourceMoved = await cdp.evaluate(`({ top: document.querySelector('#source-ruler').getBoundingClientRect().top, scroll: document.querySelector('#source-scroll').scrollTop, readerTop: document.querySelector('#ruler').getBoundingClientRect().top })`);
    assert.ok(sourceMoved.top > sourceRuler.top + 15, 'RULER-009/010: source grip moves its ruler');
    assert.equal(sourceMoved.scroll, sourceGrip.scroll, 'RULER-010: source grip does not scroll PDF');
    assert.equal(sourceMoved.readerTop, sourceGrip.readerTop, 'RULER-004: source grip leaves accessible ruler alone');
    await cdp.evaluate(`document.querySelector('#mobile-original-close').click()`);

    await cdp.evaluate(`document.querySelector('#mobile-settings-button').click()`);
    assert.ok(await cdp.evaluate(`!document.querySelector('#settings-panel').hidden && document.querySelector('#reader-pane').getBoundingClientRect().width >= 389`), 'MOBILE-007: settings sheet leaves reading width intact');
    assert.ok(await cdp.evaluate(`!!document.querySelector('#word-highlight-color')`), 'HIGHLIGHT-002: current-word colour is an independent setting');
    await cdp.evaluate(`(() => { const sentence = document.querySelector('#reader-content .sentence'); sentence.classList.add('active'); sentence.querySelector('.word')?.classList.add('active'); const word = document.querySelector('#word-highlight-color'); word.value = '#12ab34'; word.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    const highlights = await cdp.evaluate(`(() => ({ sentence: getComputedStyle(document.querySelector('.sentence.active')).backgroundColor, word: getComputedStyle(document.querySelector('.word.active')).backgroundColor, sentenceSetting: document.querySelector('#highlight-color').value }))()`);
    assert.equal(highlights.word, 'rgb(18, 171, 52)', 'HIGHLIGHT-003: active word changes colour immediately');
    assert.notEqual(highlights.sentence, highlights.word, 'HIGHLIGHT-004/005: sentence and word colours are independent');
    await cdp.evaluate(`(() => { const colour = document.querySelector('#highlight-color'); colour.value = '#3456ab'; colour.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    assert.equal(await cdp.evaluate(`getComputedStyle(document.querySelector('.word.active')).backgroundColor`), highlights.word, 'HIGHLIGHT-004: sentence colour change leaves word colour intact');
    await cdp.evaluate(`(() => { const size = document.querySelector('#font-size'); size.value = '23'; size.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('#profile-name').value = 'Mobile test'; document.querySelector('#save-profile').click(); size.value = '19'; size.dispatchEvent(new Event('change', { bubbles: true })); const profiles = document.querySelector('#saved-profiles'); profiles.value = 'Mobile test'; profiles.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    assert.equal(await cdp.evaluate('document.querySelector("#font-size").value'), '23', 'MOBILE-007: saved profile restores typography');
    assert.equal(await cdp.evaluate('document.querySelector("#word-highlight-color").value'), '#12ab34', 'HIGHLIGHT-006: saved profile restores word colour');
    await cdp.evaluate(`document.querySelector('#settings-close').click()`);
    assert.ok(await cdp.evaluate(`document.querySelector('#settings-panel').hidden`), 'MOBILE-007: settings closes');

    await cdp.file(complex);
    await until(() => cdp.evaluate(`document.querySelector('#reader-content')?.textContent.includes('Figure and Table Preservation')`));
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
    await cdp.evaluate(`document.querySelector('#review-mode-button').click()`);
    assert.ok(await cdp.evaluate(`document.body.classList.contains('review-mode') && getComputedStyle(document.querySelector('#review-toolbar')).display !== 'none' && !!document.querySelector('.review-overlay')`), 'ANNOT-025: tablet has separate Review Mode and source overlay');
    await cdp.evaluate(`document.querySelector('#annotation-tool').value = 'ink'`);
    const penStart = await cdp.evaluate(`(() => { const rect = document.querySelector('.review-overlay').getBoundingClientRect(); return { x: rect.left + 65, y: rect.top + 115 }; })()`);
    const tabletScroll = await cdp.evaluate('document.querySelector("#source-scroll").scrollTop');
    await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: penStart.x, y: penStart.y, button: 'left', clickCount: 1, pointerType: 'pen' });
    await cdp.evaluate(`(() => { const overlay = document.querySelector('.review-overlay'); overlay.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 98, pointerType: 'touch', width: 65, height: 70, clientX: ${penStart.x + 20}, clientY: ${penStart.y + 20} })); overlay.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 98, pointerType: 'touch', clientX: ${penStart.x + 20}, clientY: ${penStart.y + 80} })); })()`);
    await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: penStart.x + 55, y: penStart.y + 25, button: 'left', buttons: 1, pointerType: 'pen' });
    await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: penStart.x + 55, y: penStart.y + 25, button: 'left', clickCount: 1, pointerType: 'pen' });
    assert.equal(await cdp.evaluate('document.querySelector("#source-scroll").scrollTop'), tabletScroll, 'ANNOT-025: broad palm contact does not scroll during a stylus stroke');
    await cdp.evaluate(`(() => { document.querySelector('#annotation-tool').value = 'select'; const overlay = document.querySelector('.review-overlay'); overlay.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'pen', pointerId: 99, button: 0, clientX: ${penStart.x + 150}, clientY: ${penStart.y + 80} })); overlay.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'pen', pointerId: 99, button: 0, clientX: ${penStart.x + 150}, clientY: ${penStart.y + 80} })); })()`);
    assert.equal(await cdp.evaluate(`document.querySelectorAll('.review-overlay [data-annotation-id]').length`), 1, 'ANNOT-028: committed stylus stroke remains after clicking off');
    await cdp.evaluate(`document.querySelector('#review-mode-button').click()`);
    await cdp.evaluate(`document.querySelector('#annotation-undo').click()`); // independent desktop workflow starts empty
    assert.equal(await cdp.evaluate(`document.querySelectorAll('.review-overlay [data-annotation-id]').length`), 0, 'tablet mark is removed by explicit undo only');
    await cdp.viewport(1280, 800, false);
    const desktop = await cdp.evaluate(`(() => ({ source: document.querySelector('#source-pane').getBoundingClientRect().width, reader: document.querySelector('#reader-pane').getBoundingClientRect().width }))()`);
    assert.ok(desktop.source > 400 && desktop.reader > 400, 'MOBILE-009: desktop keeps dual panes');
    await cdp.evaluate(`document.querySelector('#review-mode-button').click(); document.querySelector('#annotation-tool').value = 'ink'`);
    await until(() => cdp.evaluate(`!!document.querySelector('.review-overlay')`));
    const inkStart = await cdp.evaluate(`(() => { const rect = document.querySelector('.review-overlay').getBoundingClientRect(); return { x: rect.left + 80, y: rect.top + 130 }; })()`);
    await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: inkStart.x, y: inkStart.y, button: 'left', clickCount: 1 });
    await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: inkStart.x + 60, y: inkStart.y + 20, button: 'left', buttons: 1 });
    await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: inkStart.x + 60, y: inkStart.y + 20, button: 'left', clickCount: 1 });
    const desktopInk = await cdp.evaluate(`({ marks: document.querySelectorAll('.review-overlay [data-annotation-id]').length, mode: document.body.classList.contains('review-mode'), overlays: document.querySelectorAll('.review-overlay').length, tool: document.querySelector('#annotation-tool').value, list: document.querySelector('#annotation-list').textContent })`);
    assert.ok(desktopInk.marks === 1, `ANNOT-001: desktop pen creates a source overlay annotation: ${JSON.stringify(desktopInk)}; ${cdp.logs.slice(-3).join(' | ')}`);
    await cdp.evaluate(`document.querySelector('#annotation-tool').value = 'select'; document.querySelector('.review-overlay').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', pointerId: 101, button: 0, clientX: ${inkStart.x + 160}, clientY: ${inkStart.y + 100} }))`);
    assert.equal(await cdp.evaluate(`document.querySelectorAll('.review-overlay [data-annotation-id]').length`), 1, 'ANNOT-028: completed desktop stroke remains after clicking off');
    await cdp.evaluate(`document.querySelector('#annotation-undo').click()`);
    assert.equal(await cdp.evaluate(`document.querySelectorAll('.review-overlay [data-annotation-id]').length`), 0, 'ANNOT-012: undo removes the exact mark');
    await cdp.evaluate(`document.querySelector('#annotation-redo').click()`);
    assert.equal(await cdp.evaluate(`document.querySelectorAll('.review-overlay [data-annotation-id]').length`), 1, 'ANNOT-013: redo restores the exact mark');
    await cdp.evaluate(`document.querySelector('#annotation-visibility').click()`);
    assert.equal(await cdp.evaluate(`document.querySelectorAll('.review-overlay [data-annotation-id]').length`), 0, 'ANNOT-015: hide clears only the overlay');
    await cdp.evaluate(`document.querySelector('#annotation-visibility').click(); document.querySelector('#annotation-list-button').click()`);
    assert.ok(await cdp.evaluate(`document.querySelectorAll('#annotation-list .annotation-entry').length === 1`), 'ANNOT-014: list retains hidden/shown mark');
    await cdp.evaluate(`document.querySelector('#annotation-panel-close').click(); document.querySelector('#review-mode-button').click()`);
    await cdp.viewport(390, 844);
    await cdp.evaluate(`document.querySelector('#mobile-menu-button').click(); document.querySelector('#mobile-menu-annotations').click()`);
    assert.ok(await cdp.evaluate(`!document.querySelector('#annotation-panel').hidden && document.querySelector('#annotation-list .annotation-entry') && getComputedStyle(document.querySelector('#annotation-list .annotation-edit')).display === 'none'`), 'ANNOT-026: phone can navigate marks but cannot edit');
    await cdp.evaluate(`document.querySelector('#annotation-list .annotation-entry button').click()`);
    assert.ok(await cdp.evaluate(`document.body.classList.contains('mobile-original-open') && document.querySelector('.review-overlay [data-annotation-id]')`), 'ANNOT-014: phone annotation list jumps to source');
    await cdp.file(hierarchy);
    await until(() => cdp.evaluate(`document.querySelector('#reader-content')?.textContent.includes('1.1.1 Eligibility')`));
    await cdp.evaluate(`document.querySelector('#outline-button').click()`);
    const outline = await cdp.evaluate(`(() => { const panel = document.querySelector('#outline-panel'); const tree = document.querySelector('#outline-tree'); return { open: !panel.hidden, width: panel.getBoundingClientRect().width, nested: tree.querySelectorAll('ul ul ul').length, labels: [...tree.querySelectorAll('button[data-outline-id]')].map(button => button.textContent) }; })()`);
    assert.ok(outline.open && outline.width >= 389 && outline.nested >= 1 && outline.labels.some(label => label.includes('1.1.1 Eligibility')), 'OUTLINE-002: phone sheet presents the parser hierarchy');
    await cdp.evaluate(`document.querySelector('#outline-tree button[data-outline-id]:is([data-level="3"])').click()`);
    assert.ok(await cdp.evaluate(`document.querySelector('#outline-panel').hidden && document.querySelector('#reader-content .block.selected')?.textContent.includes('1.1.1 Eligibility') && !!document.querySelector('.source-highlight')`), 'OUTLINE-002: nested entry navigates accessible heading and retains source anchor');
    await cdp.file(complex);
    await until(() => cdp.evaluate(`document.querySelector('#reader-content')?.textContent.includes('Figure and Table Preservation')`));
    await until(() => cdp.evaluate('window.readerDiagnostics.layoutMetrics.length > 0 || !!window.readerDiagnostics.layoutError'), 60000)
      .catch(async error => { throw new Error(`${error.message}; ${JSON.stringify(await cdp.evaluate('({ pending: window.readerDiagnostics.pendingLayoutPages, started: window.readerDiagnostics.layoutStarted, stage: window.readerDiagnostics.layoutStage, error: window.readerDiagnostics.layoutError })'))}; ${cdp.logs.slice(-8).join(' | ')}`); });
    const layoutRuntime = await cdp.evaluate('({ error: window.readerDiagnostics.layoutError, metrics: window.readerDiagnostics.layoutMetrics[0] })');
    assert.ok(!layoutRuntime.error && layoutRuntime.metrics?.modelBytes === 4917852 && ['wasm', 'webgpu'].includes(layoutRuntime.metrics.provider), `LAYOUT-ML-003: browser-local ONNX runtime loads: ${layoutRuntime.error || JSON.stringify(layoutRuntime)}; ${cdp.logs.slice(-8).join(' | ')}`);
    console.log(`LAYOUT-ML-003 measured ${JSON.stringify(layoutRuntime.metrics)}`);
    const unexpectedRequests = cdp.network.filter(request => request.method !== 'GET' ||
      /Review comment|Reader preserves|Figure and Table Preservation|Source-Faithful Reading/i.test(request.url) || request.postData);
    assert.deepEqual(unexpectedRequests, [], 'ANNOT-024/PRIVACY-REGRESSION: document and mark contents never enter network requests');
    if (process.env.READER_TEST_REAL_PDF) {
      await cdp.file(process.env.READER_TEST_REAL_PDF);
      await until(() => cdp.evaluate(`document.querySelectorAll('.page-shell').length > 1 && window.readerDiagnostics.pendingLayoutPages.length > 0`), 30000);
      await until(() => cdp.evaluate(`window.readerDiagnostics.layoutMetrics.length >= window.readerDiagnostics.pendingLayoutPages.length || !!window.readerDiagnostics.layoutError`), 30000);
      const real = await cdp.evaluate(`({ metrics: window.readerDiagnostics.layoutMetrics, error: window.readerDiagnostics.layoutError,
        headings: [...document.querySelectorAll('#reader-content .block[data-type="heading"]')].slice(0, 12).map(node => node.textContent.slice(0, 80)),
        sourceRegions: document.querySelectorAll('#reader-content .block[data-type="image"],#reader-content .block[data-type="table"],#reader-content .block[data-type="equation"]').length,
        firstPageBlocks: [...document.querySelectorAll('#reader-content .block')].slice(0, 35).map(node => [node.dataset.type, node.textContent.slice(0, 90)]) })`);
      console.log(`LAYOUT-REAL measured ${JSON.stringify(real)}`);
    }
  } finally {
    cdp?.socket.close();
    if (browser && browser.exitCode == null) { browser.kill('SIGTERM'); await Promise.race([once(browser, 'exit'), delay(3000)]); }
    if (server.exitCode == null) { server.kill('SIGTERM'); await Promise.race([once(server, 'exit'), delay(3000)]); }
    await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
