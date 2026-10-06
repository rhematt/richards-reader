import './style.css';
import { openPdf, citationsIn, speechText } from './model.js';

const $ = id => document.getElementById(id);
const sourceScroll = $('source-scroll');
const readerScroll = $('reader-scroll');
const sourceContent = $('source-content');
const readerContent = $('reader-content');
const speech = window.speechSynthesis;
const settingsIds = ['font-family', 'font-size', 'line-height', 'letter-spacing', 'word-spacing', 'paragraph-spacing', 'text-width', 'font-weight', 'text-align', 'preset', 'background-color', 'text-color', 'ruler-color', 'highlight-color', 'dim-level', 'ruler-mode', 'ruler-size', 'ruler-opacity', 'footnote-view', 'endnote-view', 'citation-view', 'reference-view', 'show-furniture', 'speak-citations', 'speak-footnotes', 'speak-endnotes', 'speak-references', 'speak-furniture'];
const presets = {
  paper: { 'background-color': '#fffdf8', 'text-color': '#26312e', 'ruler-color': '#f5d366', 'highlight-color': '#ffe18a' },
  dark: { 'background-color': '#182321', 'text-color': '#edf3eb', 'ruler-color': '#577e80', 'highlight-color': '#5c6846' },
  cream: { 'background-color': '#f8eed8', 'text-color': '#352e25', 'ruler-color': '#eabf73', 'highlight-color': '#f3d88e' }
};
const state = {
  model: null, mode: 'local', zoom: 1, currentPage: 1, selected: null,
  searchMatches: [], matchIndex: -1, speechItems: [], speechIndex: 0,
  speaking: false, paused: false, voice: null, localVoices: [],
  bookmarks: [], docKey: null, sourceObserver: null, renderTasks: new Map(),
  lastManualSource: 0, lastManualReader: 0, lastProgrammatic: 0, rulerY: null,
  generation: 0, fetchController: null
};

function toast(message, duration = 4500) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { $('toast').hidden = true; }, duration);
}

function setting(id) { const element = $(id); return element.type === 'checkbox' ? element.checked : element.value; }
function settingSnapshot() { return Object.fromEntries(settingsIds.map(id => [id, setting(id)])); }
function restoreSettings(values) {
  for (const [id, value] of Object.entries(values || {})) {
    const element = $(id);
    if (element && settingsIds.includes(id)) {
      if (element.type === 'checkbox') element.checked = Boolean(value);
      else element.value = String(value);
    }
  }
  applySettings();
}
function applySettings() {
  const style = readerContent.style;
  const family = { Atkinson: "'Atkinson Hyperlegible'", OpenDyslexic: 'OpenDyslexic', Lexend: 'Lexend', system: 'system-ui', serif: 'Georgia' }[setting('font-family')];
  style.setProperty('--reader-font', family);
  style.setProperty('--font-size', `${setting('font-size')}px`);
  style.setProperty('--line-height', setting('line-height'));
  style.setProperty('--letter-spacing', `${setting('letter-spacing')}px`);
  style.setProperty('--word-spacing', `${setting('word-spacing')}px`);
  style.setProperty('--paragraph-spacing', `${setting('paragraph-spacing')}px`);
  style.setProperty('--text-width', `${setting('text-width')}ch`);
  style.setProperty('--font-weight', setting('font-weight'));
  style.setProperty('--text-align', setting('text-align'));
  document.documentElement.style.setProperty('--reader-bg', setting('background-color'));
  document.documentElement.style.setProperty('--reader-text', setting('text-color'));
  document.documentElement.style.setProperty('--ruler-color', setting('ruler-color'));
  document.documentElement.style.setProperty('--highlight-color', setting('highlight-color'));
  document.documentElement.style.setProperty('--ruler-opacity', `${setting('ruler-opacity')}%`);
  document.documentElement.style.setProperty('--dim-opacity', Number(setting('dim-level')) / 100);
  localStorage.setItem('reader:preferences:v1', JSON.stringify(settingSnapshot()));
  if (state.model) { renderAccessible(); updateSearch(); updateRuler(); }
}
function loadProfiles() {
  const profiles = JSON.parse(localStorage.getItem('reader:profiles:v1') || '{}');
  const select = $('saved-profiles');
  select.replaceChildren(new Option('Choose…', ''));
  Object.keys(profiles).sort().forEach(name => select.add(new Option(name, name)));
  return profiles;
}

function modeStatus(mode) {
  state.mode = mode;
  $('privacy-status').innerHTML = mode === 'local'
    ? '<b>LOCAL DOCUMENT MODE</b><span>Processing: this browser · Upload: none · Speech: local only</span>'
    : '<b>REQUESTED URL MODE</b><span>Browser fetch to source site · No Reader proxy · Speech: local only</span>';
  const fileLabel = document.querySelector('.open-actions .button');
  fileLabel.textContent = mode === 'local' ? 'Open PDF' : 'Return to local mode';
  if (mode === 'local') fileLabel.setAttribute('for', 'file-input');
  else fileLabel.removeAttribute('for');
}
function fileKey(file) {
  let hash = 2166136261;
  const input = `${file.name}|${file.size}|${file.lastModified}`;
  for (const char of input) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `reader:position:${(hash >>> 0).toString(16)}`;
}
async function closeDocument() {
  state.generation++;
  state.fetchController?.abort();
  state.fetchController = null;
  stopSpeech();
  state.sourceObserver?.disconnect();
  for (const task of state.renderTasks.values()) task.cancel();
  state.renderTasks.clear();
  if (state.model?.task) await state.model.task.destroy();
  state.model = null;
  state.docKey = null;
  state.selected = null;
  state.searchMatches = [];
  state.bookmarks = [];
  state.speechItems = [];
  state.zoom = 1;
  $('zoom-value').textContent = '100%';
  sourceContent.replaceChildren(empty('Open a PDF', 'Choose a file from this device or drop one here. Its bytes stay in this browser.'));
  sourceContent.classList.remove('has-pages');
  readerContent.replaceChildren(empty('Read with context', 'Reflowed content stays linked to the authoritative original.'));
  $('heading-select').replaceChildren(new Option('Headings', ''));
  $('bookmark-list').textContent = 'None yet. Bookmarks and notes are cleared when the document closes.';
  $('close-button').disabled = true;
  $('page-indicator').textContent = 'Page — / —';
  $('search-count').textContent = '';
  $('file-input').value = '';
  modeStatus('local');
  refreshVoices();
}
function empty(title, body) {
  const element = document.createElement('div'); element.className = 'empty-state';
  const b = document.createElement('b'); b.textContent = title;
  const p = document.createElement('p'); p.textContent = body;
  element.append(b, p); return element;
}
async function open(target) {
  await closeDocument();
  const generation = state.generation;
  try {
    if (target instanceof File) {
      if (!/\.pdf$/i.test(target.name) && target.type !== 'application/pdf') throw new Error('Choose a PDF file.');
      modeStatus('local');
      state.docKey = fileKey(target);
      const bytes = new Uint8Array(await target.arrayBuffer());
      await openPdfBytes(bytes, generation);
    } else {
      modeStatus('url');
      const url = new URL(target);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Only http and https URLs are supported.');
      toast('Fetching the requested URL in this browser…');
      state.fetchController = new AbortController();
      let response;
      try { response = await fetch(url.href, { credentials: 'omit', mode: 'cors', redirect: 'follow', cache: 'no-store', referrerPolicy: 'no-referrer', signal: state.fetchController.signal }); }
      catch { throw new Error('The source site blocked browser access (CORS), or the network request failed. Reader does not use a server proxy. Try downloading the PDF and opening it locally.'); }
      if (generation !== state.generation) return;
      if (!response.ok) throw new Error(`The source returned HTTP ${response.status}.`);
      const type = response.headers.get('content-type') || '';
      if (/pdf/i.test(type) || /\.pdf(?:$|[?#])/i.test(url.pathname)) await openPdfBytes(new Uint8Array(await response.arrayBuffer()), generation);
      else if (/html|text\//i.test(type)) { const html = await response.text(); if (generation === state.generation) await openWebsite(html, url.href); }
      else throw new Error('This URL is not a PDF or readable webpage.');
      state.fetchController = null;
    }
  } catch (error) {
    if (generation !== state.generation) return;
    await closeDocument();
    if (!(target instanceof File)) modeStatus('url');
    readerContent.replaceChildren(empty(target instanceof File ? 'Unable to open this PDF' : 'Unable to open this URL', error.message || String(error)));
    toast(error.message || String(error), 9000);
  }
}

async function openPdfBytes(bytes, generation) {
  readerContent.replaceChildren(empty('Extracting in this browser…', 'Building page and source anchors.'));
  const model = await openPdf(bytes, (page, total) => { $('page-indicator').textContent = `Reading ${page} / ${total}`; });
  if (generation !== state.generation) { await model.task.destroy(); return; }
  state.model = model;
  state.currentPage = 1;
  const sourcePadding = parseFloat(getComputedStyle(sourceContent).paddingLeft) + parseFloat(getComputedStyle(sourceContent).paddingRight);
  state.zoom = Math.max(.5, Math.min(1, Math.floor((sourceScroll.clientWidth - sourcePadding - 20) / model.pages[0].width * 100) / 100));
  $('zoom-value').textContent = `${Math.round(state.zoom * 100)}%`;
  $('close-button').disabled = false;
  renderSource();
  renderAccessible();
  refreshHeadings();
  updatePageIndicator();
  if (!model.usableText) toast('No usable text layer detected. Local OCR support is not yet enabled.', 10000);
  const saved = state.docKey && Number(localStorage.getItem(state.docKey));
  if (saved > 1 && saved <= model.pages.length) setTimeout(() => navigatePage(saved), 200);
}

async function openWebsite(html, url) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,template,svg,nav,footer,header,iframe').forEach(node => node.remove());
  const root = doc.querySelector('article,main') || doc.body;
  const nodes = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,figcaption')].filter(node => !node.querySelector('p,h1,h2,h3,h4,h5,h6'));
  const blocks = nodes.map((node, index) => ({ id: `web-${index}`, page: 1, bbox: null, type: /^H[1-6]$/.test(node.tagName) ? 'heading' : node.tagName === 'FIGCAPTION' ? 'figure_caption' : node.tagName === 'PRE' ? 'code' : 'body', text: node.textContent.replace(/\s+/g, ' ').trim(), confidence: 'HTML DOM' })).filter(block => block.text);
  state.model = { website: true, url, pages: [{ number: 1, blocks }] };
  const notice = empty('Website source', 'The source page below is loaded directly from its site. Some sites block embedding. PDF coordinate synchronisation is unavailable for cross-origin webpages.');
  sourceContent.replaceChildren(notice);
  const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open original site in a new tab'; sourceContent.append(link);
  const frame = document.createElement('iframe'); frame.src = url; frame.title = 'Original website'; frame.referrerPolicy = 'no-referrer'; frame.className = 'website-frame'; sourceContent.append(frame);
  renderAccessible(); refreshHeadings(); updatePageIndicator(); $('close-button').disabled = false;
  if (!blocks.length) toast('This site returned no readable content. Its security rules or page structure may prevent extraction.', 8000);
  else toast('Website text extracted in this browser. Cross-origin source coordinates are unavailable.', 6000);
}

function renderSource() {
  sourceContent.replaceChildren();
  if (state.model.website) return;
  sourceContent.classList.add('has-pages');
  for (const page of state.model.pages) {
    const shell = document.createElement('div'); shell.className = 'page-shell'; shell.dataset.page = page.number;
    shell.style.width = `${page.width * state.zoom}px`; shell.style.height = `${page.height * state.zoom}px`;
    const label = document.createElement('span'); label.className = 'page-label'; label.textContent = `Page ${page.number}`;
    shell.append(label);
    shell.addEventListener('click', event => {
      const rect = shell.getBoundingClientRect();
      const x = (event.clientX - rect.left) / state.zoom;
      const y = (event.clientY - rect.top) / state.zoom;
      const block = nearestSourceBlock(page, x, y);
      if (block) focusBlock(block, 'source');
    });
    sourceContent.append(shell);
  }
  state.sourceObserver?.disconnect();
  state.sourceObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) renderPage(Number(entry.target.dataset.page));
  }, { root: sourceScroll, rootMargin: '800px' });
  sourceContent.querySelectorAll('.page-shell').forEach(shell => state.sourceObserver.observe(shell));
}
async function renderPage(number) {
  const page = state.model?.pages[number - 1];
  const shell = sourceContent.querySelector(`[data-page="${number}"]`);
  if (!page || !shell || shell.querySelector('canvas')) return;
  const canvas = document.createElement('canvas');
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.source.getViewport({ scale: state.zoom * ratio });
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  shell.prepend(canvas);
  const task = page.source.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport });
  state.renderTasks.set(number, task);
  try { await task.promise; if (state.model && page === state.model.pages[number - 1]) fillCrops(page, canvas, ratio); }
  catch (error) { if (error?.name !== 'RenderingCancelledException') toast(`Page ${number} could not render.`); }
  finally { state.renderTasks.delete(number); }
}
function fillCrops(page, canvas, ratio) {
  for (const block of page.blocks.filter(b => ['image', 'table', 'equation', 'source_region'].includes(b.type))) {
    const target = readerContent.querySelector(`[data-crop="${block.id}"]`);
    if (!target || target.src) continue;
    const pad = 5 * state.zoom * ratio;
    const sx = Math.max(0, Math.floor(block.bbox.x * state.zoom * ratio - pad));
    const sy = Math.max(0, Math.floor(block.bbox.y * state.zoom * ratio - pad));
    const sw = Math.min(canvas.width - sx, Math.ceil(block.bbox.w * state.zoom * ratio + pad * 2));
    const sh = Math.min(canvas.height - sy, Math.ceil(block.bbox.h * state.zoom * ratio + pad * 2));
    if (sw < 1 || sh < 1) continue;
    const crop = document.createElement('canvas'); crop.width = sw; crop.height = sh;
    crop.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    target.src = crop.toDataURL('image/png');
  }
}
function nearestSourceBlock(page, x, y) {
  return page.blocks.filter(block => block.bbox && block.type !== 'table_source_text').map(block => {
    const b = block.bbox;
    const dx = Math.max(b.x - x, 0, x - b.x - b.w);
    const dy = Math.max(b.y - y, 0, y - b.y - b.h);
    return { block, distance: Math.hypot(dx * 1.5, dy) };
  }).sort((a, b) => a.distance - b.distance)[0]?.block;
}

function isVisible(block) {
  if (['header', 'footer', 'page_number'].includes(block.type)) return setting('show-furniture');
  if (block.type === 'table_source_text') return false;
  const key = { footnote: 'footnote-view', endnote: 'endnote-view', bibliography: 'reference-view' }[block.section || block.type];
  return !key || setting(key) !== 'hide';
}
function renderAccessible() {
  if (!state.model) return;
  readerContent.replaceChildren();
  if (state.model.usableText === false) {
    const notice = document.createElement('div'); notice.className = 'reader-notice';
    notice.textContent = 'No usable text layer detected. Local OCR support is not yet enabled. The original page remains available on the left.';
    readerContent.append(notice);
  }
  for (const page of state.model.pages) {
    const marker = document.createElement('div'); marker.className = 'page-break'; marker.textContent = `Page ${page.number}`;
    readerContent.append(marker);
    for (const block of page.blocks) {
      if (!isVisible(block)) continue;
      const element = document.createElement(block.type === 'heading' ? `h${block.level || 2}` : 'div');
      element.className = 'block'; element.dataset.id = block.id; element.dataset.type = block.type; element.tabIndex = 0;
      if (['footnote', 'endnote', 'bibliography'].includes(block.section || block.type) && setting({ footnote: 'footnote-view', endnote: 'endnote-view', bibliography: 'reference-view' }[block.section || block.type]) === 'collapse') {
        const button = document.createElement('button'); button.className = 'collapsed-note'; button.textContent = `Show ${block.section || block.type} from page ${block.page}`;
        button.addEventListener('click', event => { event.stopPropagation(); button.replaceWith(document.createTextNode(block.text)); }); element.append(button);
      } else if (['image', 'table', 'source_region', 'equation'].includes(block.type)) {
        if (block.type === 'table' && block.rows) {
          const table = document.createElement('table'); table.className = 'extracted-table';
          for (const row of block.rows) { const tr = document.createElement('tr'); row.forEach(cell => { const td = document.createElement('td'); td.textContent = cell; tr.append(td); }); table.append(tr); }
          element.append(table);
        } else {
          const label = document.createElement('span'); label.className = 'source-crop-label'; label.textContent = block.type === 'table' ? 'Source table region — structure uncertain' : block.type === 'equation' ? 'Source equation region' : block.type === 'image' ? 'Image from source page' : 'Unclassified source region';
          const img = document.createElement('img'); img.className = 'source-crop'; img.dataset.crop = block.id; img.alt = label.textContent;
          element.append(label, img);
        }
      } else appendSentences(element, block);
      if (!state.model.website) {
        const anchor = document.createElement('span'); anchor.className = 'source-page-link'; anchor.textContent = `↗ source p. ${block.page}`; element.append(anchor);
      }
      element.addEventListener('click', event => {
        if (event.target.closest('.sentence')) state.speechIndex = state.speechItems.findIndex(item => item.element === event.target.closest('.sentence'));
        focusBlock(block, 'reader');
        if (event.target.closest('.sentence') && state.localVoices.length) startSpeech(Math.max(0, state.speechIndex));
      });
      element.addEventListener('keydown', event => { if (event.key === 'Enter') focusBlock(block, 'reader'); });
      readerContent.append(element);
    }
  }
  state.speechItems = collectSpeechItems();
  $('speak-button').disabled = !state.localVoices.length || !state.speechItems.length;
  if (!state.speechItems.length) $('speech-status').textContent = 'No readable text for speech';
  else if (state.localVoices.length) $('speech-status').textContent = 'Device voice · no cloud TTS';
  if (state.selected) readerContent.querySelector(`[data-id="${state.selected.id}"]`)?.classList.add('selected');
  for (const page of state.model.pages) {
    const canvas = sourceContent.querySelector(`[data-page="${page.number}"] canvas`);
    if (canvas) fillCrops(page, canvas, Math.min(window.devicePixelRatio || 1, 2));
  }
}
function appendSentences(element, block) {
  const segments = Intl.Segmenter ? [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(block.text)].map(x => x.segment) : block.text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [block.text];
  segments.forEach((sentence, sentenceIndex) => {
    const span = document.createElement('span'); span.className = 'sentence'; span.dataset.sentenceIndex = sentenceIndex;
    const citations = citationsIn(sentence);
    let pos = 0; let wordIndex = 0;
    const addWords = text => {
      for (const token of text.match(/\s+|\S+/g) || []) {
        if (/^\s+$/.test(token)) span.append(document.createTextNode(token));
        else { const word = document.createElement('span'); word.className = 'word'; word.dataset.wordIndex = wordIndex++; word.textContent = token; span.append(word); }
      }
    };
    for (const citation of citations) {
      addWords(sentence.slice(pos, citation.start));
      const citationSpan = document.createElement('span'); citationSpan.className = `citation ${setting('citation-view') === 'show' ? '' : setting('citation-view') === 'dim' ? 'dimmed' : 'hidden'}`;
      if (setting('speak-citations')) {
        for (const token of citation.text.match(/\s+|\S+/g) || []) {
          if (/^\s+$/.test(token)) citationSpan.append(document.createTextNode(token));
          else { const word = document.createElement('span'); word.className = 'word'; word.dataset.wordIndex = wordIndex++; word.textContent = token; citationSpan.append(word); }
        }
      } else citationSpan.textContent = citation.text;
      span.append(citationSpan);
      pos = citation.end;
    }
    addWords(sentence.slice(pos));
    span.dataset.speechText = setting('speak-citations') ? sentence.trim() : speechText({ text: sentence });
    element.append(span);
  });
}
function collectSpeechItems() {
  const items = [];
  const visibleElements = new Map([...readerContent.querySelectorAll('.block')].map(element => [element.dataset.id, element]));
  for (const block of state.model.pages.flatMap(page => page.blocks)) {
    if (['image', 'table', 'source_region', 'equation', 'table_source_text'].includes(block.type)) continue;
    if (['header', 'footer', 'page_number'].includes(block.type) && !setting('speak-furniture')) continue;
    if (block.type === 'footnote' && !setting('speak-footnotes')) continue;
    if ((block.type === 'endnote' || block.section === 'endnote') && !setting('speak-endnotes')) continue;
    if ((block.type === 'bibliography' || block.section === 'bibliography') && !setting('speak-references')) continue;
    const segmentTexts = Intl.Segmenter ? [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(block.text)].map(x => x.segment) : block.text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [block.text];
    const element = visibleElements.get(block.id);
    for (let index = 0; index < segmentTexts.length; index++) {
      const text = setting('speak-citations') ? segmentTexts[index].trim() : speechText({ text: segmentTexts[index] });
      if (text) items.push({ block, element: element?.querySelector(`[data-sentence-index="${index}"]`) || null, text });
    }
  }
  return items;
}
function refreshHeadings() {
  const select = $('heading-select'); select.replaceChildren(new Option('Headings', ''));
  for (const block of state.model.pages.flatMap(page => page.blocks).filter(b => b.type === 'heading')) select.add(new Option(`${block.text.slice(0, 55)} · p.${block.page}`, block.id));
}

function focusBlock(block, from = 'reader', gentle = false) {
  if (!block || !state.model) return;
  state.selected = block;
  readerContent.querySelectorAll('.block.selected').forEach(el => el.classList.remove('selected'));
  const accessible = readerContent.querySelector(`[data-id="${block.id}"]`);
  accessible?.classList.add('selected');
  if (from === 'source' && accessible) { state.lastProgrammatic = Date.now(); accessible.scrollIntoView({ block: gentle ? 'nearest' : 'center', behavior: gentle ? 'smooth' : 'auto' }); }
  if (!state.model.website) focusSource(block, gentle);
  state.currentPage = block.page;
  updatePageIndicator();
  if (state.docKey) localStorage.setItem(state.docKey, String(block.page));
}
function focusSource(block, gentle = false) {
  if (!block.bbox) return;
  const shell = sourceContent.querySelector(`[data-page="${block.page}"]`);
  if (!shell) return;
  sourceContent.querySelectorAll('.source-highlight').forEach(el => el.remove());
  const box = document.createElement('div'); box.className = 'source-highlight';
  box.style.left = `${block.bbox.x * state.zoom}px`; box.style.top = `${block.bbox.y * state.zoom}px`;
  box.style.width = `${Math.max(8, block.bbox.w * state.zoom)}px`; box.style.height = `${Math.max(8, block.bbox.h * state.zoom)}px`;
  shell.append(box);
  state.lastProgrammatic = Date.now();
  const target = shell.offsetTop + block.bbox.y * state.zoom - sourceScroll.clientHeight * .35;
  if (!gentle || Math.abs(sourceScroll.scrollTop - target) > sourceScroll.clientHeight * .45) sourceScroll.scrollTo({ top: target, behavior: gentle ? 'smooth' : 'auto' });
}
function updatePageIndicator() { $('page-indicator').textContent = `Page ${state.currentPage} / ${state.model?.pages.length || '—'}`; }
function navigatePage(number) {
  if (!state.model) return;
  const page = state.model.pages[Math.max(0, Math.min(state.model.pages.length - 1, number - 1))];
  state.currentPage = page.number; updatePageIndicator();
  const block = page.blocks.find(isVisible);
  if (block) focusBlock(block, 'reader');
  else sourceContent.querySelector(`[data-page="${page.number}"]`)?.scrollIntoView({ block: 'start' });
}

function updateSearch() {
  if (!state.model) return;
  const query = $('search-input').value.trim().toLocaleLowerCase();
  state.searchMatches = query ? state.model.pages.flatMap(page => page.blocks).filter(block => block.text?.toLocaleLowerCase().includes(query) && block.type !== 'table_source_text') : [];
  if (state.matchIndex >= state.searchMatches.length) state.matchIndex = -1;
  readerContent.querySelectorAll('.search-hit,.search-current').forEach(el => el.classList.remove('search-hit', 'search-current'));
  for (const block of state.searchMatches) readerContent.querySelector(`[data-id="${block.id}"]`)?.classList.add('search-hit');
  $('search-count').textContent = query ? `${state.searchMatches.length} block${state.searchMatches.length === 1 ? '' : 's'}` : '';
}
function moveSearch(delta) {
  if (!state.searchMatches.length) return;
  state.matchIndex = (state.matchIndex + delta + state.searchMatches.length) % state.searchMatches.length;
  const block = state.searchMatches[state.matchIndex];
  focusBlock(block, 'source');
  readerContent.querySelector(`[data-id="${block.id}"]`)?.classList.add('search-current');
  $('search-count').textContent = `${state.matchIndex + 1} / ${state.searchMatches.length}`;
}

function stopSpeech() {
  speech?.cancel(); state.speaking = false; state.paused = false;
  $('speak-button').textContent = 'Play';
  readerContent.querySelectorAll('.sentence.active,.word.active').forEach(el => el.classList.remove('active'));
}
function refreshVoices() {
  if (!speech) { $('voice-select').replaceChildren(new Option('Speech unavailable', '')); return; }
  state.localVoices = speech.getVoices().filter(voice => voice.localService === true);
  const select = $('voice-select'); select.replaceChildren();
  if (!state.localVoices.length) {
    select.add(new Option('No verified local voices', ''));
    $('speech-status').textContent = 'Speech disabled: no verified device voice';
    $('speak-button').disabled = true;
  } else {
    state.localVoices.forEach((voice, index) => select.add(new Option(`${voice.name} (${voice.lang}) · device`, String(index))));
    const preferred = state.localVoices.findIndex(voice => voice.default);
    select.value = String(Math.max(0, preferred));
    $('speech-status').textContent = state.model ? 'Device voice · no cloud TTS' : 'Open a document to use speech';
    $('speak-button').disabled = !state.model || !state.speechItems.length;
  }
}
function startSpeech(index = state.speechIndex) {
  if (!state.localVoices.length || !state.speechItems.length) return;
  speech.cancel();
  state.speechIndex = Math.max(0, Math.min(index, state.speechItems.length - 1));
  state.speaking = true; state.paused = false;
  speakCurrent();
}
function speakCurrent() {
  const item = state.speechItems[state.speechIndex];
  if (!item || !state.speaking) { stopSpeech(); return; }
  const voice = state.localVoices[Number($('voice-select').value)] || state.localVoices[0];
  if (!voice || voice.localService !== true) { stopSpeech(); return; }
  readerContent.querySelectorAll('.sentence.active,.word.active').forEach(el => el.classList.remove('active'));
  item.element?.classList.add('active');
  focusBlock(item.block, 'reader', true);
  item.element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (item.element) setTimeout(() => moveRulerToElement(item.element), 250);
  const utterance = new SpeechSynthesisUtterance(item.text);
  utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = Number($('speech-rate').value) || 1;
  utterance.onboundary = event => {
    if (event.name !== 'word') return;
    const count = (item.text.slice(0, event.charIndex).match(/\S+/g) || []).length;
    item.element?.querySelector('.word.active')?.classList.remove('active');
    item.element?.querySelector(`[data-word-index="${count}"]`)?.classList.add('active');
    if (item.element) moveRulerToElement(item.element);
  };
  utterance.onend = () => { if (state.speaking && !state.paused) { state.speechIndex++; speakCurrent(); } };
  utterance.onerror = () => { stopSpeech(); $('speech-status').textContent = 'Device speech stopped'; };
  $('speak-button').textContent = 'Pause';
  speech.speak(utterance);
}
function toggleSpeech() {
  if (!state.speaking) startSpeech();
  else if (state.paused) { speech.resume(); state.paused = false; $('speak-button').textContent = 'Pause'; }
  else { speech.pause(); state.paused = true; $('speak-button').textContent = 'Resume'; }
}
function moveSpeech(direction, unit) {
  if (!state.speechItems.length) return;
  let next = state.speechIndex + direction;
  if (unit === 'paragraph') {
    const current = state.speechItems[state.speechIndex]?.block.id;
    while (next >= 0 && next < state.speechItems.length && state.speechItems[next].block.id === current) next += direction;
  }
  startSpeech(Math.max(0, Math.min(next, state.speechItems.length - 1)));
}

function updateRuler() {
  const mode = setting('ruler-mode'); const ruler = $('ruler');
  ruler.hidden = mode === 'off'; ruler.classList.toggle('dim', mode === 'dim');
  if (mode === 'off') return;
  const lineHeight = parseFloat(getComputedStyle(readerContent).lineHeight) || 30;
  ruler.style.height = `${lineHeight * (mode === 'line' ? 1 : Number(setting('ruler-size')))}px`;
  if (state.rulerY == null) state.rulerY = readerScroll.clientHeight / 2;
  ruler.style.top = `${state.rulerY + readerScroll.scrollTop - ruler.offsetHeight / 2}px`;
}
function moveRulerToElement(element) {
  if (setting('ruler-mode') === 'off') return;
  const viewport = readerScroll.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  state.rulerY = rect.top - viewport.top + Math.min(rect.height / 2, 25);
  updateRuler();
}

function setupEvents() {
  document.querySelector('.open-actions .button').addEventListener('click', event => { if (state.mode === 'url') { event.preventDefault(); location.assign('/'); } });
  $('file-input').addEventListener('change', event => { if (event.target.files[0]) { if (state.mode === 'url') return toast('Return to local mode before opening a PDF.'); open(event.target.files[0]); } });
  for (const eventName of ['dragenter', 'dragover']) sourceScroll.addEventListener(eventName, event => { event.preventDefault(); sourceScroll.classList.add('dragging'); });
  sourceScroll.addEventListener('dragleave', () => sourceScroll.classList.remove('dragging'));
  sourceScroll.addEventListener('drop', event => { event.preventDefault(); sourceScroll.classList.remove('dragging'); const file = [...event.dataTransfer.files].find(file => /\.pdf$/i.test(file.name) || file.type === 'application/pdf'); if (file) { if (state.mode === 'url') toast('Return to local mode before opening a PDF.'); else open(file); } });
  $('url-form').addEventListener('submit', event => { event.preventDefault(); if ($('url-input').value) location.assign(`/?url=${encodeURIComponent($('url-input').value)}`); });
  $('close-button').addEventListener('click', () => { if (state.mode === 'url') location.assign('/'); else closeDocument(); });
  $('previous-page').addEventListener('click', () => navigatePage(state.currentPage - 1));
  $('next-page').addEventListener('click', () => navigatePage(state.currentPage + 1));
  $('zoom-out').addEventListener('click', () => changeZoom(-.15));
  $('zoom-in').addEventListener('click', () => changeZoom(.15));
  $('search-input').addEventListener('input', () => { state.matchIndex = -1; updateSearch(); });
  $('search-previous').addEventListener('click', () => moveSearch(-1));
  $('search-next').addEventListener('click', () => moveSearch(1));
  $('search-input').addEventListener('keydown', event => { if (event.key === 'Enter') moveSearch(event.shiftKey ? -1 : 1); });
  $('heading-select').addEventListener('change', event => { const block = state.model?.pages.flatMap(page => page.blocks).find(b => b.id === event.target.value); if (block) focusBlock(block, 'source'); });
  $('maximize-source').addEventListener('click', () => { const maximised = document.body.classList.toggle('source-maximised'); document.documentElement.style.setProperty('--source-width', maximised ? 'calc(100% - 8px)' : '50%'); $('maximize-source').textContent = maximised ? 'Restore panes' : 'Maximise original'; });
  $('settings-button').addEventListener('click', () => { $('settings-panel').hidden = false; $('settings-button').setAttribute('aria-expanded', 'true'); });
  $('settings-close').addEventListener('click', () => { $('settings-panel').hidden = true; $('settings-button').setAttribute('aria-expanded', 'false'); });
  $('preset').addEventListener('change', event => { if (presets[event.target.value]) restoreSettings({ ...settingSnapshot(), ...presets[event.target.value] }); });
  for (const id of settingsIds.filter(id => id !== 'preset')) $(id).addEventListener('change', () => { if (id.endsWith('-color')) $('preset').value = 'custom'; applySettings(); });
  $('save-profile').addEventListener('click', () => { const name = $('profile-name').value.trim().slice(0, 40); if (!name) return toast('Enter a profile name.'); const profiles = loadProfiles(); profiles[name] = settingSnapshot(); localStorage.setItem('reader:profiles:v1', JSON.stringify(profiles)); loadProfiles(); $('saved-profiles').value = name; toast(`Saved profile: ${name}`); });
  $('saved-profiles').addEventListener('change', event => { const profile = loadProfiles()[event.target.value]; if (profile) restoreSettings(profile); });
  $('bookmark-button').addEventListener('click', addBookmark);
  $('speak-button').addEventListener('click', toggleSpeech);
  $('previous-sentence').addEventListener('click', () => moveSpeech(-1, 'sentence'));
  $('next-sentence').addEventListener('click', () => moveSpeech(1, 'sentence'));
  $('previous-paragraph').addEventListener('click', () => moveSpeech(-1, 'paragraph'));
  $('next-paragraph').addEventListener('click', () => moveSpeech(1, 'paragraph'));
  $('voice-select').addEventListener('change', () => { if (state.speaking) startSpeech(); });
  speech?.addEventListener?.('voiceschanged', refreshVoices);
  readerScroll.addEventListener('pointermove', event => { if (setting('ruler-mode') === 'off') return; state.rulerY = event.clientY - readerScroll.getBoundingClientRect().top; updateRuler(); });
  readerScroll.addEventListener('touchmove', event => { if (setting('ruler-mode') === 'off') return; state.rulerY = event.touches[0].clientY - readerScroll.getBoundingClientRect().top; updateRuler(); }, { passive: true });
  readerScroll.tabIndex = 0;
  readerScroll.addEventListener('keydown', event => { if (['ArrowUp', 'ArrowDown'].includes(event.key) && setting('ruler-mode') !== 'off') { event.preventDefault(); state.rulerY = Math.max(0, Math.min(readerScroll.clientHeight, (state.rulerY || readerScroll.clientHeight / 2) + (event.key === 'ArrowDown' ? 1 : -1) * (parseFloat(getComputedStyle(readerContent).lineHeight) || 30))); updateRuler(); } });
  const divider = $('pane-divider'); let dragging = false;
  divider.addEventListener('pointerdown', event => { dragging = true; divider.setPointerCapture(event.pointerId); });
  divider.addEventListener('pointermove', event => { if (!dragging) return; const percent = Math.max(20, Math.min(80, event.clientX / window.innerWidth * 100)); document.documentElement.style.setProperty('--source-width', `${percent}%`); });
  divider.addEventListener('pointerup', () => { dragging = false; });
  divider.addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--source-width')) || 50; document.documentElement.style.setProperty('--source-width', `${Math.max(20, Math.min(80, current + (event.key === 'ArrowRight' ? 5 : -5)))}%`); });
  for (const eventName of ['wheel', 'touchstart', 'pointerdown']) { sourceScroll.addEventListener(eventName, () => state.lastManualSource = Date.now(), { passive: true }); readerScroll.addEventListener(eventName, () => state.lastManualReader = Date.now(), { passive: true }); }
  let sourceTimer, readerTimer;
  sourceScroll.addEventListener('scroll', () => { clearTimeout(sourceTimer); sourceTimer = setTimeout(() => syncFromSource(), 180); });
  readerScroll.addEventListener('scroll', () => { clearTimeout(readerTimer); readerTimer = setTimeout(() => syncFromReader(), 180); updateRuler(); });
}
function changeZoom(delta) {
  if (!state.model || state.model.website) return;
  const page = state.currentPage;
  state.zoom = Math.max(.5, Math.min(2.5, Math.round((state.zoom + delta) * 100) / 100));
  $('zoom-value').textContent = `${Math.round(state.zoom * 100)}%`;
  for (const task of state.renderTasks.values()) task.cancel(); state.renderTasks.clear();
  renderSource();
  const selected = state.selected;
  if (selected) focusSource(selected); else sourceContent.querySelector(`[data-page="${page}"]`)?.scrollIntoView();
}
function syncFromSource() {
  if (!state.model || state.model.website || Date.now() - state.lastProgrammatic < 850 || Date.now() - state.lastManualReader < 2500) return;
  const center = sourceScroll.scrollTop + sourceScroll.clientHeight * .36;
  const shell = [...sourceContent.querySelectorAll('.page-shell')].find(el => el.offsetTop <= center && el.offsetTop + el.offsetHeight >= center);
  if (!shell) return;
  const page = state.model.pages[Number(shell.dataset.page) - 1];
  const y = (center - shell.offsetTop) / state.zoom;
  const block = page.blocks.filter(b => b.bbox && isVisible(b)).sort((a, b) => Math.abs(a.bbox.y - y) - Math.abs(b.bbox.y - y))[0];
  if (block) focusBlock(block, 'source', true);
}
function syncFromReader() {
  if (!state.model || state.model.website || Date.now() - state.lastProgrammatic < 850 || Date.now() - state.lastManualSource < 2500) return;
  const center = readerScroll.getBoundingClientRect().top + readerScroll.clientHeight * .35;
  const elements = [...readerContent.querySelectorAll('.block')];
  const nearest = elements.sort((a, b) => Math.abs(a.getBoundingClientRect().top - center) - Math.abs(b.getBoundingClientRect().top - center))[0];
  const block = state.model.pages.flatMap(page => page.blocks).find(b => b.id === nearest?.dataset.id);
  if (block) focusBlock(block, 'reader', true);
}
function addBookmark() {
  if (!state.selected?.bbox) return toast('Select a source-linked PDF block first.');
  const note = prompt('Optional note for this source location:') || '';
  state.bookmarks.push({ page: state.selected.page, bbox: { ...state.selected.bbox }, id: state.selected.id, note: note.slice(0, 500) });
  const list = $('bookmark-list'); list.replaceChildren();
  state.bookmarks.forEach((bookmark, index) => { const button = document.createElement('button'); button.textContent = `Page ${bookmark.page} · ${bookmark.note || `Bookmark ${index + 1}`}`; button.addEventListener('click', () => { const block = state.model?.pages.flatMap(page => page.blocks).find(b => b.id === bookmark.id); if (block) focusBlock(block, 'source'); $('settings-panel').hidden = true; }); list.append(button); });
  toast('Bookmark held in this browser session.');
}
function initialTarget() {
  const query = new URLSearchParams(location.search).get('url');
  if (query) return query;
  const path = decodeURIComponent(location.pathname.slice(1));
  return /^https?:\/\//i.test(path) ? path + location.search + location.hash : null;
}

setupEvents();
try { restoreSettings(JSON.parse(localStorage.getItem('reader:preferences:v1') || '{}')); } catch { applySettings(); }
loadProfiles(); refreshVoices();
const target = initialTarget();
if (target) { $('url-input').value = target; open(target); }
