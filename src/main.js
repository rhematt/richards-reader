import './style.css';
import { openPdf, refineComplexPages, citationsIn, speechText, equationSpeechText } from './model.js';
import { buildOutline, flattenOutline } from './layout/outline.js';
import { layoutDetectorStatus } from './layout/detector.js';
import { PROFILE_SETTING_IDS, WORD_HIGHLIGHT_DEFAULT, exportProfile, importProfile } from './profile.js';
import { defineWord } from './dictionary/index.js';
import { createClickArbiter } from './dictionary/click-arbitration.js';
import { AnnotationStore, screenToPdfPoint } from './review/annotations.js';
import { drawAnnotations } from './review/overlay.js';

const $ = id => document.getElementById(id);
const sourceScroll = $('source-scroll');
const readerScroll = $('reader-scroll');
const sourceContent = $('source-content');
const readerContent = $('reader-content');
const speech = window.speechSynthesis;
const mobileMedia = window.matchMedia('(max-width: 700px), (max-width: 950px) and (max-height: 500px)');
const isMobile = () => mobileMedia.matches;
const settingsIds = PROFILE_SETTING_IDS;
const presets = {
  paper: { 'background-color': '#fffdf8', 'text-color': '#26312e', 'ruler-color': '#f5d366', 'highlight-color': '#ffe18a', 'word-highlight-color': WORD_HIGHLIGHT_DEFAULT },
  dark: { 'background-color': '#182321', 'text-color': '#edf3eb', 'ruler-color': '#577e80', 'highlight-color': '#b7a961', 'word-highlight-color': '#e6a65b' },
  cream: { 'background-color': '#f8eed8', 'text-color': '#352e25', 'ruler-color': '#eabf73', 'highlight-color': '#f3d88e', 'word-highlight-color': '#eab66e' }
};
const state = {
  model: null, mode: 'local', zoom: 1, currentPage: 1, selected: null,
  searchMatches: [], matchIndex: -1, speechItems: [], speechIndex: 0,
  speaking: false, paused: false, voice: null, localVoices: [],
  bookmarks: [], docKey: null, sourceObserver: null, cropObserver: null, renderTasks: new Map(),
  lastManualSource: 0, lastManualReader: 0, lastProgrammatic: 0, rulerY: null, sourceRulerY: null,
  generation: 0, fetchController: null, mobileReaderPosition: 0,
  originalPdfBytes: null, documentName: 'document.pdf', selectedAnnotation: null, reviewDraft: null,
  pendingLayoutRefresh: false, layoutMetrics: [], reviewTouchScroll: null,
  activePenPointer: null, lastPenAt: 0
};
const reviewStore = new AnnotationStore();
let selectedDefinitionWord = '';
// Read-only operational measurements contain no source or annotation content.
window.readerDiagnostics = Object.freeze({
  get layoutMetrics() { return state.layoutMetrics.map(item => ({ ...item })); },
  get layoutError() { return state.layoutError || null; },
  get pendingLayoutPages() { return state.model?.pages.filter(page => page.needsLayoutInference).map(page => page.number) || []; },
  get layoutStarted() { return !!state.layoutStarted; },
  get layoutStage() { return layoutDetectorStatus(); },
  get interaction() { return { speechIndex: state.speechIndex, speaking: state.speaking, paused: state.paused, selectedId: state.selected?.id || null, rulerY: state.rulerY, sourceRulerY: state.sourceRulerY }; }
});

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
function applySettings(rerender = true) {
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
  document.documentElement.style.setProperty('--word-highlight-color', setting('word-highlight-color'));
  document.documentElement.style.setProperty('--ruler-opacity', `${setting('ruler-opacity')}%`);
  document.documentElement.style.setProperty('--dim-opacity', Number(setting('dim-level')) / 100);
  localStorage.setItem('reader:preferences:v1', JSON.stringify(settingSnapshot()));
  if (state.model) { if (rerender) { renderAccessible(); updateSearch(); } updateRuler(); }
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
  state.pendingLayoutRefresh = false;
  state.layoutMetrics = [];
  state.layoutError = null;
  state.layoutStarted = false;
  state.fetchController?.abort();
  state.fetchController = null;
  stopSpeech();
  state.sourceObserver?.disconnect();
  state.cropObserver?.disconnect();
  closeMobileOriginal();
  setReviewMode(false);
  reviewStore.clear();
  state.originalPdfBytes = null;
  state.selectedAnnotation = null;
  state.reviewDraft = null;
  state.reviewTouchScroll = null;
  state.activePenPointer = null;
  $('annotation-panel').hidden = true;
  $('review-mode-button').disabled = true;
  document.body.classList.remove('document-open');
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
  $('reading-progress').textContent = '0% · p. —/—';
  $('bookmark-list').textContent = 'None yet. Bookmarks and notes are cleared when the document closes.';
  $('close-button').disabled = true;
  $('page-indicator').textContent = 'Page — / —';
  $('mobile-page-indicator').textContent = 'Page — / —';
  $('mobile-original-button').disabled = true;
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
      state.documentName = target.name;
      const bytes = new Uint8Array(await target.arrayBuffer());
      await openPdfBytes(bytes, generation);
    } else {
      modeStatus('url');
      const url = new URL(target);
      state.documentName = decodeURIComponent(url.pathname.split('/').pop() || 'document.pdf');
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
  state.originalPdfBytes = bytes.slice();
  $('review-mode-button').disabled = false;
  document.body.classList.add('document-open');
  $('mobile-original-button').disabled = false;
  state.currentPage = 1;
  const sourcePadding = parseFloat(getComputedStyle(sourceContent).paddingLeft) + parseFloat(getComputedStyle(sourceContent).paddingRight);
  const sourceWidth = isMobile() ? window.innerWidth : sourceScroll.clientWidth;
  state.zoom = Math.max(.5, Math.min(1, Math.floor((sourceWidth - sourcePadding - 20) / model.pages[0].width * 100) / 100));
  $('zoom-value').textContent = `${Math.round(state.zoom * 100)}%`;
  $('mobile-zoom-value').textContent = $('zoom-value').textContent;
  $('close-button').disabled = false;
  renderSource();
  renderAccessible();
  refreshHeadings();
  updatePageIndicator();
  updateReadingProgress();
  if (!model.usableText) toast('No usable text layer detected. Local OCR support is not yet enabled.', 10000);
  const saved = state.docKey && Number(localStorage.getItem(state.docKey));
  if (saved > 1 && saved <= model.pages.length) setTimeout(() => navigatePage(saved), 200);
  // The deterministic projection is immediately usable. Complex pages may
  // improve in the background once the local layout model has loaded.
  const beginRefinement = () => {
    state.layoutStarted = true;
    refineComplexPages(model, (page, result) => {
      if (state.generation !== generation || state.model !== model) return;
      if (result.metrics) state.layoutMetrics.push({ page, ...result.metrics });
      if (result.error) { state.layoutError = result.error; return; }
      if (!result.refined) return;
      if (state.speaking) state.pendingLayoutRefresh = true;
      else refreshAfterLayoutRefinement();
    }, () => state.generation === generation && state.model === model).catch(error => { state.layoutError = String(error); });
  };
  if ('requestIdleCallback' in window) requestIdleCallback(beginRefinement, { timeout: 1800 });
  else setTimeout(beginRefinement, 100);
}

function refreshAfterLayoutRefinement() {
  if (!state.model || state.speaking) return;
  state.pendingLayoutRefresh = false;
  const current = currentReadingBlock();
  const oldElement = current && readerContent.querySelector(`[data-id="${current.id}"]`);
  const oldTop = oldElement?.getBoundingClientRect().top;
  const oldScroll = readerScroll.scrollTop;
  const speechBlock = state.speechItems[state.speechIndex]?.block.id;
  renderAccessible();
  refreshHeadings();
  updateSearch();
  const replacement = current && state.model.pages[current.page - 1]?.blocks.find(block => block.id === current.id);
  if (replacement) state.selected = replacement;
  const newElement = replacement && readerContent.querySelector(`[data-id="${replacement.id}"]`);
  readerScroll.scrollTop = newElement && oldTop != null ? oldScroll + newElement.getBoundingClientRect().top - oldTop : oldScroll;
  const speechIndex = state.speechItems.findIndex(item => item.block.id === speechBlock);
  if (speechIndex >= 0) state.speechIndex = speechIndex;
  updateReadingProgress();
  updateRuler();
}

async function openWebsite(html, url) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,template,svg,nav,footer,header,iframe').forEach(node => node.remove());
  const root = doc.querySelector('article,main') || doc.body;
  const nodes = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,figcaption')].filter(node => !node.querySelector('p,h1,h2,h3,h4,h5,h6'));
  const blocks = nodes.map((node, index) => ({ id: `web-${index}`, page: 1, bbox: null, type: /^H[1-6]$/.test(node.tagName) ? 'heading' : node.tagName === 'FIGCAPTION' ? 'figure_caption' : node.tagName === 'PRE' ? 'code' : 'body', text: node.textContent.replace(/\s+/g, ' ').trim(), confidence: 'HTML DOM' })).filter(block => block.text);
  state.model = { website: true, url, pages: [{ number: 1, blocks }] };
  document.body.classList.add('document-open');
  $('mobile-original-button').disabled = false;
  const notice = empty('Website source', 'The source page below is loaded directly from its site. Some sites block embedding. PDF coordinate synchronisation is unavailable for cross-origin webpages.');
  sourceContent.replaceChildren(notice);
  const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open original site in a new tab'; sourceContent.append(link);
  const frame = document.createElement('iframe'); frame.src = url; frame.title = 'Original website'; frame.referrerPolicy = 'no-referrer'; frame.className = 'website-frame'; sourceContent.append(frame);
  renderAccessible(); refreshHeadings(); updatePageIndicator(); updateReadingProgress(); $('close-button').disabled = false;
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
    const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlay.classList.add('review-overlay');
    overlay.setAttribute('aria-label', `Annotations on page ${page.number}`);
    shell.append(overlay);
    overlay.addEventListener('pointerdown', event => startAnnotation(event, page, overlay));
    overlay.addEventListener('pointermove', event => moveAnnotation(event, page, overlay));
    overlay.addEventListener('pointerup', event => finishAnnotation(event, page, overlay));
    overlay.addEventListener('pointercancel', event => cancelAnnotationPointer(event, page, overlay));
    overlay.addEventListener('lostpointercapture', event => {
      if (state.reviewDraft?.pointerId === event.pointerId) finishAnnotation(event, page, overlay, true);
      if (state.reviewTouchScroll?.pointerId === event.pointerId) state.reviewTouchScroll = null;
    });
    shell.addEventListener('click', event => {
      if (document.body.classList.contains('review-mode')) return;
      const rect = shell.getBoundingClientRect();
      const x = (event.clientX - rect.left) / state.zoom;
      const y = (event.clientY - rect.top) / state.zoom;
      const block = nearestSourceBlock(page, x, y);
      if (block) {
        if (isMobile()) closeMobileOriginal({ restore: false });
        focusBlock(block, 'source');
      }
    });
    sourceContent.append(shell);
  }
  renderOverlays();
  state.sourceObserver?.disconnect();
  state.sourceObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) renderPage(Number(entry.target.dataset.page));
  }, { root: sourceScroll, rootMargin: '800px' });
  sourceContent.querySelectorAll('.page-shell').forEach(shell => state.sourceObserver.observe(shell));
}
function renderOverlays() {
  if (!state.model || state.model.website) return;
  let annotations = reviewStore.visible ? reviewStore.list() : [];
  if (state.reviewDraft) {
    if (state.reviewDraft.moving) annotations = annotations.filter(item => item.id !== state.reviewDraft.id);
    annotations.push(state.reviewDraft.preview);
  }
  for (const page of state.model.pages) {
    const overlay = sourceContent.querySelector(`[data-page="${page.number}"] .review-overlay`);
    if (overlay) drawAnnotations(overlay, page, annotations, state.zoom, state.selectedAnnotation);
  }
}
function annotationPoint(event, page, overlay) {
  return screenToPdfPoint(page.source.getViewport({ scale: state.zoom }), overlay.getBoundingClientRect(), event.clientX, event.clientY);
}
function translateGeometry(geometry, dx, dy) {
  const moved = structuredClone(geometry);
  if (moved.point) { moved.point.x += dx; moved.point.y += dy; }
  if (moved.rect) for (const key of ['x1', 'x2']) moved.rect[key] += dx;
  if (moved.rect) for (const key of ['y1', 'y2']) moved.rect[key] += dy;
  if (moved.paths) for (const path of moved.paths) for (const point of path) { point.x += dx; point.y += dy; }
  return moved;
}
function startAnnotation(event, page, overlay) {
  if (!document.body.classList.contains('review-mode') || isMobile()) return;
  if (event.pointerType === 'touch') {
    // A broad contact, or any contact near a current stylus stroke, is a palm.
    // An intentional lone finger drag scrolls the original source pane.
    if (state.activePenPointer != null || Date.now() - state.lastPenAt < 700 ||
      Math.max(event.width || 0, event.height || 0) > 32) return;
    state.reviewTouchScroll = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    overlay.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
  if (event.button !== 0) return;
  if (event.pointerType === 'pen') {
    state.activePenPointer = event.pointerId;
    state.lastPenAt = Date.now();
    state.reviewTouchScroll = null;
  }
  const point = annotationPoint(event, page, overlay);
  const tool = $('annotation-tool').value;
  if (tool === 'select') {
    const id = event.target.closest('[data-annotation-id]')?.getAttribute('data-annotation-id');
    state.selectedAnnotation = id || null;
    const original = id && reviewStore.get(id);
    if (original) state.reviewDraft = { pointerId: event.pointerId, page: page.number, start: point, id, original,
      moving: true, preview: original };
    renderOverlays();
    return;
  }
  event.preventDefault(); event.stopPropagation();
  if (tool === 'note') {
    const text = prompt('Comment at this source location:');
    if (text?.trim()) addReviewAnnotation({ type: 'note', page: page.number,
      geometry: { point }, text: text.trim().slice(0, 2000) });
    return;
  }
  overlay.setPointerCapture(event.pointerId);
  const geometry = tool === 'ink' ? { paths: [[point]] } : { rect: { x1: point.x, y1: point.y, x2: point.x, y2: point.y } };
  state.reviewDraft = { pointerId: event.pointerId, page: page.number, start: point, tool,
    preview: { id: 'preview', type: tool, page: page.number, geometry,
      appearance: { color: $('annotation-color').value, width: Number($('annotation-width').value) || 2 } } };
  renderOverlays();
}
function moveAnnotation(event, page, overlay) {
  if (event.pointerType === 'touch') {
    const scroll = state.reviewTouchScroll;
    if (!scroll || scroll.pointerId !== event.pointerId || state.activePenPointer != null) return;
    sourceScroll.scrollTop += scroll.y - event.clientY;
    sourceScroll.scrollLeft += scroll.x - event.clientX;
    scroll.x = event.clientX; scroll.y = event.clientY;
    event.preventDefault();
    return;
  }
  const draft = state.reviewDraft;
  if (!draft || draft.pointerId !== event.pointerId || draft.page !== page.number) return;
  const point = annotationPoint(event, page, overlay);
  if (draft.moving) draft.preview = { ...draft.original, geometry: translateGeometry(draft.original.geometry, point.x - draft.start.x, point.y - draft.start.y) };
  else if (draft.tool === 'ink') draft.preview.geometry.paths[0].push(point);
  else { draft.preview.geometry.rect.x2 = point.x; draft.preview.geometry.rect.y2 = point.y; }
  renderOverlays();
}
function finishAnnotation(event, page, overlay, cancelled = false) {
  if (event.pointerType === 'touch') {
    if (state.reviewTouchScroll?.pointerId === event.pointerId) state.reviewTouchScroll = null;
    return;
  }
  if (event.pointerType === 'pen' && state.activePenPointer === event.pointerId) {
    state.activePenPointer = null;
    state.lastPenAt = Date.now();
  }
  const draft = state.reviewDraft;
  if (!draft || draft.pointerId !== event.pointerId || draft.page !== page.number) return;
  event.preventDefault(); event.stopPropagation();
  if (!cancelled) moveAnnotation(event, page, overlay);
  state.reviewDraft = null;
  if (draft.moving) {
    if (JSON.stringify(draft.preview.geometry) !== JSON.stringify(draft.original.geometry)) reviewStore.update(draft.id, { geometry: draft.preview.geometry });
  } else {
    const item = draft.preview;
    if (item.type === 'freetext') {
      const text = prompt('Text for this source annotation:');
      if (!text?.trim()) { renderOverlays(); return; }
      item.text = text.trim().slice(0, 2000);
    }
    if (item.type !== 'ink' && (Math.abs(item.geometry.rect.x2 - item.geometry.rect.x1) < 2 || Math.abs(item.geometry.rect.y2 - item.geometry.rect.y1) < 2)) {
      renderOverlays(); return;
    }
    delete item.id;
    addReviewAnnotation(item);
  }
  renderOverlays(); renderAnnotationList();
}
function cancelAnnotationPointer(event, page, overlay) {
  if (event.pointerType === 'touch') {
    if (state.reviewTouchScroll?.pointerId === event.pointerId) state.reviewTouchScroll = null;
    return;
  }
  // Safari can cancel a pen stream when a second contact appears. Retain the
  // last confirmed sample instead of silently discarding the whole stroke.
  finishAnnotation(event, page, overlay, true);
}
function addReviewAnnotation(item) {
  const created = reviewStore.add({ ...item, sourceAnchor: { page: item.page } });
  state.selectedAnnotation = created.id;
  renderOverlays(); renderAnnotationList();
}
function renderAnnotationList() {
  const list = $('annotation-list'); list.replaceChildren();
  const annotations = reviewStore.list();
  if (!annotations.length) { list.textContent = 'No session annotations.'; return; }
  for (const item of annotations) {
    const entry = document.createElement('div'); entry.className = 'annotation-entry';
    const title = document.createElement('b'); title.textContent = `${item.type} · page ${item.page}`;
    const description = document.createElement('div'); description.textContent = item.text || '';
    const go = document.createElement('button'); go.type = 'button'; go.textContent = 'Go to source'; go.addEventListener('click', () => focusAnnotation(item));
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'annotation-edit'; edit.textContent = 'Edit';
    edit.addEventListener('click', () => {
      if (['note', 'freetext'].includes(item.type)) {
        const text = prompt('Edit annotation text:', item.text || '');
        if (text === null) return;
        reviewStore.update(item.id, { text: text.trim().slice(0, 2000) });
      } else reviewStore.update(item.id, { appearance: { color: $('annotation-color').value, width: Number($('annotation-width').value) || 2 } });
      renderOverlays(); renderAnnotationList();
    });
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'annotation-delete'; remove.textContent = 'Delete';
    remove.addEventListener('click', () => { reviewStore.remove(item.id); if (state.selectedAnnotation === item.id) state.selectedAnnotation = null; renderOverlays(); renderAnnotationList(); });
    entry.append(title, description, go, edit, remove); list.append(entry);
  }
}
function focusAnnotation(item) {
  if (!state.model || state.model.website) return;
  $('annotation-panel').hidden = true;
  if (isMobile()) openMobileOriginal();
  state.selectedAnnotation = item.id;
  renderPage(item.page);
  renderOverlays();
  const shell = sourceContent.querySelector(`[data-page="${item.page}"]`);
  const anchor = item.geometry.point || item.geometry.paths?.[0]?.[0] ||
    { x: item.geometry.rect.x1, y: item.geometry.rect.y2 };
  const [, y] = state.model.pages[item.page - 1].source.getViewport({ scale: state.zoom }).convertToViewportPoint(anchor.x, anchor.y);
  sourceScroll.scrollTo({ top: shell.offsetTop + y - sourceScroll.clientHeight * .35 });
  state.currentPage = item.page; updatePageIndicator();
}
function setReviewMode(enabled) {
  if (enabled && (isMobile() || !state.model || state.model.website)) return;
  document.body.classList.toggle('review-mode', enabled);
  $('review-toolbar').hidden = !enabled;
  $('review-mode-button').setAttribute('aria-pressed', String(enabled));
  $('review-mode-button').textContent = enabled ? 'Read mode' : 'Review mode';
  state.reviewDraft = null;
  renderOverlays();
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
      const element = document.createElement(block.type === 'title' ? 'h1' : block.type === 'heading' ? `h${Math.min(6, (block.level || 1) + 1)}` : 'div');
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
          const img = document.createElement('img'); img.className = 'source-crop'; img.dataset.crop = block.id; img.dataset.page = block.page; img.alt = label.textContent;
          element.append(label, img);
        }
      } else appendSentences(element, block);
      if (!state.model.website) {
        const anchor = document.createElement('button'); anchor.type = 'button'; anchor.className = 'source-page-link'; anchor.textContent = `View original · p. ${block.page}`;
        anchor.addEventListener('click', event => {
          event.stopPropagation();
          focusBlock(block, 'reader');
          if (isMobile()) openMobileOriginal(block);
        });
        element.append(anchor);
      }
      const clicks = createClickArbiter({
        onSentence: sentence => {
          if (!element.isConnected) return;
          if (sentence) state.speechIndex = state.speechItems.findIndex(item => item.element === sentence);
          focusBlock(block, 'reader');
          if (sentence && state.localVoices.length) startSpeech(Math.max(0, state.speechIndex));
        },
        onDefine: word => {
          const token = word.textContent.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
          if (!/^[\p{L}]{2,24}$/u.test(token)) return;
          const range = document.createRange(); range.selectNodeContents(word);
          const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
          showDefinition(token);
        }
      });
      element.addEventListener('click', event => {
        clicks.click({ sentenceId: event.target.closest('.sentence'), word: event.target.closest('.word'), detail: event.detail });
      });
      element.addEventListener('dblclick', event => {
        event.preventDefault();
        clicks.doubleClick({ word: event.target.closest('.word') });
      });
      element.addEventListener('keydown', event => { if (event.key === 'Enter') focusBlock(block, 'reader'); });
      readerContent.append(element);
    }
  }
  state.speechItems = collectSpeechItems();
  updateReadingProgress();
  $('speak-button').disabled = !state.localVoices.length || !state.speechItems.length;
  if (!state.speechItems.length) $('speech-status').textContent = 'No readable text for speech';
  else if (state.localVoices.length) $('speech-status').textContent = 'Device voice · no cloud TTS';
  if (state.selected) readerContent.querySelector(`[data-id="${state.selected.id}"]`)?.classList.add('selected');
  for (const page of state.model.pages) {
    const canvas = sourceContent.querySelector(`[data-page="${page.number}"] canvas`);
    if (canvas) fillCrops(page, canvas, Math.min(window.devicePixelRatio || 1, 2));
  }
  state.cropObserver?.disconnect();
  if (!state.model.website && isMobile()) {
    state.cropObserver = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) renderPage(Number(entry.target.dataset.page));
    }, { root: readerScroll, rootMargin: '450px' });
    readerContent.querySelectorAll('.source-crop').forEach(image => state.cropObserver.observe(image));
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
    if (block.type === 'equation') {
      const text = equationSpeechText(block, setting('equation-speech'));
      if (text) items.push({ block, element: visibleElements.get(block.id) || null, text });
      continue;
    }
    if (['image', 'table', 'source_region', 'table_source_text'].includes(block.type)) continue;
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
  for (const node of flattenOutline(buildOutline(state.model.pages))) {
    const indent = '\u00a0\u00a0'.repeat(node.level - 1);
    select.add(new Option(`${indent}${node.text.slice(0, 55)} · p.${node.page}`, node.id));
  }
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
  updateReadingProgress(block);
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
function currentReadingBlock() {
  if (!state.model) return null;
  const targetY = readerScroll.getBoundingClientRect().top + readerScroll.clientHeight * .3;
  const nearest = [...readerContent.querySelectorAll('.block')].sort((a, b) => Math.abs(a.getBoundingClientRect().top - targetY) - Math.abs(b.getBoundingClientRect().top - targetY))[0];
  return state.model.pages.flatMap(page => page.blocks).find(block => block.id === nearest?.dataset.id) || state.selected;
}
function openMobileOriginal(block = null) {
  if (!isMobile() || !state.model) return;
  state.mobileReaderPosition = readerScroll.scrollTop;
  closeMobileMenu();
  closeSettings();
  document.body.classList.add('mobile-original-open');
  $('mobile-original-button').setAttribute('aria-expanded', 'true');
  const anchor = block || currentReadingBlock();
  if (anchor) focusBlock(anchor, 'reader');
  if (anchor && !state.model.website) renderPage(anchor.page);
  updateRuler();
  if (state.speaking && setting('speech-follow-ruler')) setTimeout(() => moveSourceRulerToBlock(state.speechItems[state.speechIndex]?.block), 250);
}
function closeMobileOriginal({ restore = true } = {}) {
  if (!document.body.classList.contains('mobile-original-open')) return;
  document.body.classList.remove('mobile-original-open');
  $('mobile-original-button').setAttribute('aria-expanded', 'false');
  if (restore) {
    state.lastProgrammatic = Date.now();
    readerScroll.scrollTop = state.mobileReaderPosition;
  }
  updateRuler();
}
function closeMobileMenu() {
  $('mobile-menu').hidden = true;
  $('mobile-menu-button').setAttribute('aria-expanded', 'false');
}
function toggleMobileMenu() {
  const open = $('mobile-menu').hidden;
  $('mobile-menu').hidden = !open;
  $('mobile-menu-button').setAttribute('aria-expanded', String(open));
}
function openSettings() {
  closeMobileMenu();
  $('settings-panel').hidden = false;
  $('settings-button').setAttribute('aria-expanded', 'true');
  $('mobile-settings-button').setAttribute('aria-expanded', 'true');
}
function setFocusMode(enabled) {
  if (document.body.classList.contains('focus-mode') === enabled) return;
  closeMobileMenu(); closeSettings(); closeMobileOriginal();
  const top = readerScroll.scrollTop;
  document.body.classList.toggle('focus-mode', enabled);
  $('focus-exit').hidden = !enabled;
  readerScroll.scrollTop = top;
  updateRuler(); updateReadingProgress();
}
function closeSettings() {
  $('settings-panel').hidden = true;
  $('settings-button').setAttribute('aria-expanded', 'false');
  $('mobile-settings-button').setAttribute('aria-expanded', 'false');
}
function updateDefinitionAction() {
  const selection = window.getSelection();
  const word = selection?.toString().trim();
  const node = selection?.anchorNode;
  if (!word || !/^[\p{L}]{2,24}$/u.test(word) || !node || !readerContent.contains(node)) {
    $('define-button').hidden = true;
    return;
  }
  selectedDefinitionWord = word;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  const button = $('define-button');
  button.style.left = `${Math.min(innerWidth - 90, Math.max(8, rect.left))}px`;
  button.style.top = `${Math.min(innerHeight - 55, Math.max(8, rect.bottom + 5))}px`;
  button.hidden = false;
}
async function showDefinition(word = selectedDefinitionWord) {
  if (typeof word === 'string') selectedDefinitionWord = word;
  $('define-button').hidden = true;
  const panel = $('dictionary-panel');
  const result = $('dictionary-result');
  panel.hidden = false;
  $('dictionary-headword').textContent = selectedDefinitionWord.toLocaleLowerCase('en');
  result.textContent = 'Looking up the local dictionary…';
  try {
    const entry = await defineWord(selectedDefinitionWord);
    result.replaceChildren();
    if (!entry) { result.textContent = 'No local definition is available for this word.'; return; }
    $('dictionary-headword').textContent = entry.headword;
    for (const sense of entry.senses) {
      const p = document.createElement('p');
      const part = document.createElement('b'); part.textContent = `${sense.partOfSpeech} · `;
      p.append(part, document.createTextNode(sense.definition)); result.append(p);
    }
  } catch { result.textContent = 'The local dictionary is unavailable on this device.'; }
}
function updatePageIndicator() {
  const label = `Page ${state.currentPage} / ${state.model?.pages.length || '—'}`;
  $('page-indicator').textContent = label;
  $('mobile-page-indicator').textContent = label;
}
function updateReadingProgress(active = null) {
  if (!state.model) return;
  const blocks = state.model.pages.flatMap(page => page.blocks).filter(block => isVisible(block) && !['header', 'footer', 'page_number'].includes(block.type));
  const block = active || currentReadingBlock() || blocks[0];
  const index = Math.max(0, blocks.findIndex(item => item.id === block?.id));
  const percent = blocks.length < 2 ? (blocks.length ? 100 : 0) : Math.round(index / (blocks.length - 1) * 100);
  const headings = [];
  for (const item of blocks.slice(0, index + 1)) if (item.type === 'heading') {
    headings.length = Math.max(0, (item.level || 1) - 1);
    headings.push(item.text);
  }
  const location = headings.slice(-2).join(' › ');
  $('reading-progress').textContent = `${percent}% · p. ${block?.page || state.currentPage}/${state.model.pages.length}${location ? ` · ${location}` : ''}`;
}
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
  readerContent.querySelectorAll('.sentence.active,.word.active,.block.active').forEach(el => el.classList.remove('active'));
  if (state.pendingLayoutRefresh) refreshAfterLayoutRefinement();
}
function refreshVoices() {
  if (!speech) {
    for (const id of ['voice-select', 'mobile-voice-select']) $(id).replaceChildren(new Option('Speech unavailable', ''));
    return;
  }
  state.localVoices = speech.getVoices().filter(voice => voice.localService === true);
  const selects = [$('voice-select'), $('mobile-voice-select')];
  selects.forEach(select => select.replaceChildren());
  if (!state.localVoices.length) {
    selects.forEach(select => select.add(new Option('No verified local voices', '')));
    $('speech-status').textContent = 'Speech disabled: no verified device voice';
    $('speak-button').disabled = true;
  } else {
    state.localVoices.forEach((voice, index) => selects.forEach(select => select.add(new Option(`${voice.name} (${voice.lang}) · device`, String(index)))));
    const preferred = state.localVoices.findIndex(voice => voice.default);
    selects.forEach(select => { select.value = String(Math.max(0, preferred)); });
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
  readerContent.querySelectorAll('.sentence.active,.word.active,.block.active').forEach(el => el.classList.remove('active'));
  item.element?.classList.add('active');
  focusBlock(item.block, 'reader', true);
  item.element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (setting('speech-follow-ruler')) setTimeout(() => {
    if (item.element) moveRulerToElement(item.element);
    moveSourceRulerToBlock(item.block);
  }, 250);
  const utterance = new SpeechSynthesisUtterance(item.text);
  utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = Number($('speech-rate').value) || 1;
  utterance.onboundary = event => {
    if (event.name !== 'word') return;
    const count = (item.text.slice(0, event.charIndex).match(/\S+/g) || []).length;
    item.element?.querySelector('.word.active')?.classList.remove('active');
    item.element?.querySelector(`[data-word-index="${count}"]`)?.classList.add('active');
    if (item.element && setting('speech-follow-ruler')) moveRulerToElement(item.element);
    if (setting('speech-follow-ruler')) moveSourceRulerToBlock(item.block);
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
  const mode = setting('ruler-mode');
  const lineHeight = parseFloat(getComputedStyle(readerContent).lineHeight) || 30;
  for (const [id, scroll, key, height] of [['ruler', readerScroll, 'rulerY', lineHeight], ['source-ruler', sourceScroll, 'sourceRulerY', 28]]) {
    const ruler = $(id);
    ruler.hidden = mode === 'off' || (id === 'source-ruler' && (!state.model || state.model.website));
    ruler.classList.toggle('dim', mode === 'dim');
    if (ruler.hidden || !scroll.clientHeight) continue;
    ruler.style.height = `${height * (mode === 'line' ? 1 : Number(setting('ruler-size')))}px`;
    if (state[key] == null) state[key] = scroll.clientHeight / 2;
    const rect = scroll.getBoundingClientRect();
    state[key] = Math.max(ruler.offsetHeight / 2, Math.min(rect.height - ruler.offsetHeight / 2, state[key]));
    if (isMobile()) {
      ruler.style.left = `${rect.left}px`; ruler.style.right = 'auto'; ruler.style.width = `${rect.width}px`;
      ruler.style.top = `${rect.top + state[key] - ruler.offsetHeight / 2}px`;
    } else {
      ruler.style.left = `${scroll.scrollLeft}px`; ruler.style.right = 'auto'; ruler.style.width = `${scroll.clientWidth}px`;
      ruler.style.top = `${state[key] + scroll.scrollTop - ruler.offsetHeight / 2}px`;
    }
  }
}
function moveRulerToElement(element) {
  if (setting('ruler-mode') === 'off') return;
  const viewport = readerScroll.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  state.rulerY = rect.top - viewport.top + Math.min(rect.height / 2, 25);
  updateRuler();
}
function moveSourceRulerToBlock(block) {
  if (!block?.bbox || setting('ruler-mode') === 'off' || !sourceScroll.clientHeight) return;
  const shell = sourceContent.querySelector(`[data-page="${block.page}"]`);
  if (!shell) return;
  const viewport = sourceScroll.getBoundingClientRect();
  const page = shell.getBoundingClientRect();
  state.sourceRulerY = page.top + block.bbox.y * state.zoom - viewport.top + Math.min(block.bbox.h * state.zoom / 2, 25);
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
  $('mobile-previous-page').addEventListener('click', () => navigatePage(state.currentPage - 1));
  $('mobile-next-page').addEventListener('click', () => navigatePage(state.currentPage + 1));
  $('mobile-zoom-out').addEventListener('click', () => changeZoom(-.15));
  $('mobile-zoom-in').addEventListener('click', () => changeZoom(.15));
  $('mobile-original-button').addEventListener('click', () => openMobileOriginal());
  $('mobile-menu-button').addEventListener('click', toggleMobileMenu);
  $('mobile-menu-settings').addEventListener('click', openSettings);
  $('mobile-menu-focus').addEventListener('click', () => setFocusMode(true));
  $('mobile-menu-annotations').addEventListener('click', () => { closeMobileMenu(); renderAnnotationList(); $('annotation-panel').hidden = false; });
  $('mobile-original-close').addEventListener('click', () => closeMobileOriginal());
  $('search-input').addEventListener('input', () => { state.matchIndex = -1; updateSearch(); });
  $('search-previous').addEventListener('click', () => moveSearch(-1));
  $('search-next').addEventListener('click', () => moveSearch(1));
  $('search-input').addEventListener('keydown', event => { if (event.key === 'Enter') moveSearch(event.shiftKey ? -1 : 1); });
  $('heading-select').addEventListener('change', event => { const block = state.model?.pages.flatMap(page => page.blocks).find(b => b.id === event.target.value); if (block) focusBlock(block, 'source'); });
  $('maximize-source').addEventListener('click', () => { const maximised = document.body.classList.toggle('source-maximised'); document.documentElement.style.setProperty('--source-width', maximised ? 'calc(100% - 8px)' : '50%'); $('maximize-source').textContent = maximised ? 'Restore panes' : 'Maximise original'; });
  $('settings-button').addEventListener('click', openSettings);
  $('focus-button').addEventListener('click', () => setFocusMode(true));
  $('focus-exit').addEventListener('click', () => setFocusMode(false));
  $('review-mode-button').addEventListener('click', () => setReviewMode(!document.body.classList.contains('review-mode')));
  $('annotation-tool').addEventListener('change', () => {
    if ($('annotation-tool').value === 'highlight' && $('annotation-color').value === '#b91c1c') $('annotation-color').value = '#facc15';
    if ($('annotation-tool').value === 'ink' && $('annotation-color').value === '#facc15') $('annotation-color').value = '#b91c1c';
  });
  $('annotation-undo').addEventListener('click', () => { reviewStore.undo(); renderOverlays(); renderAnnotationList(); });
  $('annotation-redo').addEventListener('click', () => { reviewStore.redo(); renderOverlays(); renderAnnotationList(); });
  $('annotation-visibility').addEventListener('click', () => {
    reviewStore.setVisible(!reviewStore.visible);
    $('annotation-visibility').textContent = reviewStore.visible ? 'Hide marks' : 'Show marks';
    $('annotation-visibility').setAttribute('aria-pressed', String(reviewStore.visible));
    renderOverlays();
  });
  $('annotation-list-button').addEventListener('click', () => { renderAnnotationList(); $('annotation-panel').hidden = false; });
  $('annotation-panel-close').addEventListener('click', () => { $('annotation-panel').hidden = true; });
  $('export-marked').addEventListener('click', async () => {
    if (!state.originalPdfBytes) return;
    try {
      const { exportMarkedPdf } = await import('./review/export.js');
      const bytes = await exportMarkedPdf(state.originalPdfBytes, reviewStore.list());
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const link = document.createElement('a'); link.href = url;
      link.download = `${state.documentName.replace(/\.pdf$/i, '').replace(/[^\w.-]/g, '_')}-marked.pdf`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Marked PDF exported. The original was not changed.');
    } catch (error) { toast(`Could not export marked PDF: ${error.message}`); }
  });
  $('define-button').addEventListener('click', () => showDefinition());
  $('dictionary-close').addEventListener('click', () => { $('dictionary-panel').hidden = true; });
  document.addEventListener('selectionchange', updateDefinitionAction);
  $('mobile-settings-button').addEventListener('click', openSettings);
  $('settings-close').addEventListener('click', closeSettings);
  $('preset').addEventListener('change', event => { if (presets[event.target.value]) restoreSettings({ ...settingSnapshot(), ...presets[event.target.value] }); });
  for (const id of settingsIds.filter(id => id !== 'preset')) $(id).addEventListener('change', () => { if (id.endsWith('-color')) $('preset').value = 'custom'; applySettings(!id.endsWith('-color') && !['ruler-mode', 'ruler-size', 'ruler-opacity', 'dim-level', 'speech-follow-ruler'].includes(id)); });
  $('save-profile').addEventListener('click', () => { const name = $('profile-name').value.trim().slice(0, 40); if (!name) return toast('Enter a profile name.'); const profiles = loadProfiles(); profiles[name] = settingSnapshot(); localStorage.setItem('reader:profiles:v1', JSON.stringify(profiles)); loadProfiles(); $('saved-profiles').value = name; toast(`Saved profile: ${name}`); });
  $('saved-profiles').addEventListener('change', event => {
    const name = event.target.value;
    const profile = loadProfiles()[name];
    if (profile) { $('saved-profiles').value = name; restoreSettings({ 'word-highlight-color': WORD_HIGHLIGHT_DEFAULT, 'equation-speech': 'announce', ...profile }); }
  });
  $('export-profile').addEventListener('click', () => {
    const blob = new Blob([exportProfile(settingSnapshot())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'reader-profile.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('import-profile-file').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { restoreSettings(importProfile(await file.text())); toast('Reading profile imported.'); }
    catch { toast('Could not import this profile.'); }
    event.target.value = '';
  });
  $('bookmark-button').addEventListener('click', addBookmark);
  $('speak-button').addEventListener('click', toggleSpeech);
  $('previous-sentence').addEventListener('click', () => moveSpeech(-1, 'sentence'));
  $('next-sentence').addEventListener('click', () => moveSpeech(1, 'sentence'));
  $('previous-paragraph').addEventListener('click', () => moveSpeech(-1, 'paragraph'));
  $('next-paragraph').addEventListener('click', () => moveSpeech(1, 'paragraph'));
  for (const id of ['voice-select', 'mobile-voice-select']) $(id).addEventListener('change', event => {
    $(id === 'voice-select' ? 'mobile-voice-select' : 'voice-select').value = event.target.value;
    if (state.speaking) startSpeech();
  });
  speech?.addEventListener?.('voiceschanged', refreshVoices);
  readerScroll.addEventListener('pointermove', event => { if (isMobile() || setting('ruler-mode') === 'off') return; state.rulerY = event.clientY - readerScroll.getBoundingClientRect().top; updateRuler(); });
  readerScroll.addEventListener('touchmove', event => { if (isMobile() || setting('ruler-mode') === 'off') return; state.rulerY = event.touches[0].clientY - readerScroll.getBoundingClientRect().top; updateRuler(); }, { passive: true });
  sourceScroll.addEventListener('pointermove', event => { if (isMobile() || document.body.classList.contains('review-mode') || setting('ruler-mode') === 'off') return; state.sourceRulerY = event.clientY - sourceScroll.getBoundingClientRect().top; updateRuler(); });
  for (const [gripId, scroll, key] of [['ruler-grip', readerScroll, 'rulerY'], ['source-ruler-grip', sourceScroll, 'sourceRulerY']]) {
    const grip = $(gripId); let dragging = false;
    grip.addEventListener('pointerdown', event => { if (!isMobile()) return; event.preventDefault(); event.stopPropagation(); dragging = true; grip.setPointerCapture(event.pointerId); });
    grip.addEventListener('pointermove', event => { if (!dragging) return; event.preventDefault(); state[key] = event.clientY - scroll.getBoundingClientRect().top; updateRuler(); });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) grip.addEventListener(name, () => { dragging = false; });
  }
  readerScroll.tabIndex = 0;
  readerScroll.addEventListener('keydown', event => { if (['ArrowUp', 'ArrowDown'].includes(event.key) && setting('ruler-mode') !== 'off') { event.preventDefault(); state.rulerY = Math.max(0, Math.min(readerScroll.clientHeight, (state.rulerY || readerScroll.clientHeight / 2) + (event.key === 'ArrowDown' ? 1 : -1) * (parseFloat(getComputedStyle(readerContent).lineHeight) || 30))); updateRuler(); } });
  const divider = $('pane-divider'); let dragging = false;
  divider.addEventListener('pointerdown', event => { dragging = true; divider.setPointerCapture(event.pointerId); });
  divider.addEventListener('pointermove', event => { if (!dragging) return; const percent = Math.max(20, Math.min(80, event.clientX / window.innerWidth * 100)); document.documentElement.style.setProperty('--source-width', `${percent}%`); });
  divider.addEventListener('pointerup', () => { dragging = false; });
  divider.addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--source-width')) || 50; document.documentElement.style.setProperty('--source-width', `${Math.max(20, Math.min(80, current + (event.key === 'ArrowRight' ? 5 : -5)))}%`); });
  for (const eventName of ['wheel', 'touchstart', 'pointerdown']) { sourceScroll.addEventListener(eventName, () => state.lastManualSource = Date.now(), { passive: true }); readerScroll.addEventListener(eventName, () => state.lastManualReader = Date.now(), { passive: true }); }
  let sourceTimer, readerTimer;
  sourceScroll.addEventListener('scroll', () => { clearTimeout(sourceTimer); sourceTimer = setTimeout(() => syncFromSource(), 180); updateRuler(); });
  readerScroll.addEventListener('scroll', () => { clearTimeout(readerTimer); readerTimer = setTimeout(() => syncFromReader(), 180); updateRuler(); updateReadingProgress(); });
  mobileMedia.addEventListener('change', () => {
    if (!isMobile()) closeMobileOriginal();
    if (isMobile()) setReviewMode(false);
    if (state.model) renderAccessible();
    updateRuler();
  });
  window.addEventListener('resize', updateRuler);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { setFocusMode(false); closeMobileOriginal(); closeSettings(); closeMobileMenu(); } });
}
function changeZoom(delta) {
  if (!state.model || state.model.website) return;
  const page = state.currentPage;
  state.zoom = Math.max(.5, Math.min(2.5, Math.round((state.zoom + delta) * 100) / 100));
  $('zoom-value').textContent = `${Math.round(state.zoom * 100)}%`;
  $('mobile-zoom-value').textContent = $('zoom-value').textContent;
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
