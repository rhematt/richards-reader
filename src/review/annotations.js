const clone = value => structuredClone(value);
const round = value => Math.round(value * 1e6) / 1e6;
const TYPES = new Set(['ink', 'highlight', 'underline', 'strikeout', 'note', 'freetext']);
let idSerial = 0;

function annotationId() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    try { return cryptoApi.randomUUID(); } catch { /* Try the next local ID source. */ }
  }
  try {
    if (typeof cryptoApi?.getRandomValues === 'function') {
      const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  } catch { /* The session fallback must still commit the mark. */ }
  return `local-${Date.now().toString(36)}-${(++idSerial).toString(36)}`;
}

export function screenToPdfPoint(viewport, rect, clientX, clientY) {
  const x = (clientX - rect.left) * viewport.width / rect.width;
  const y = (clientY - rect.top) * viewport.height / rect.height;
  const [px, py] = viewport.convertToPdfPoint(x, y);
  return { x: round(px), y: round(py) };
}

export function pdfToScreenPoint(viewport, rect, point) {
  const [x, y] = viewport.convertToViewportPoint(point.x, point.y);
  return { x: rect.left + x * rect.width / viewport.width,
    y: rect.top + y * rect.height / viewport.height };
}

export class AnnotationStore {
  #items = [];
  #undo = [];
  #redo = [];
  visible = true;

  list() { return clone(this.#items); }
  get(id) { return clone(this.#items.find(item => item.id === id) || null); }
  #record() { this.#undo.push(clone(this.#items)); this.#redo.length = 0; }
  add(annotation) {
    if (!TYPES.has(annotation.type) || !Number.isInteger(annotation.page) || annotation.page < 1 || !annotation.geometry) throw new Error('Invalid annotation');
    if (annotation.id && this.#items.some(item => item.id === annotation.id)) throw new Error('Duplicate annotation id');
    const copy = clone(annotation);
    const generated = annotation.id || annotationId();
    let id = generated;
    while (this.#items.some(item => item.id === id)) id = `${generated}-${(++idSerial).toString(36)}`;
    const item = { ...copy, id, createdAt: annotation.createdAt || new Date().toISOString() };
    const result = clone(item);
    this.#record();
    this.#items.push(item);
    return result;
  }
  update(id, changes) {
    const index = this.#items.findIndex(item => item.id === id);
    if (index < 0) return false;
    this.#record();
    this.#items[index] = { ...this.#items[index], ...clone(changes), id };
    return true;
  }
  remove(id) {
    const index = this.#items.findIndex(item => item.id === id);
    if (index < 0) return false;
    this.#record(); this.#items.splice(index, 1); return true;
  }
  undo() {
    if (!this.#undo.length) return false;
    this.#redo.push(clone(this.#items)); this.#items = this.#undo.pop(); return true;
  }
  redo() {
    if (!this.#redo.length) return false;
    this.#undo.push(clone(this.#items)); this.#items = this.#redo.pop(); return true;
  }
  setVisible(visible) { this.visible = Boolean(visible); }
  clear() { this.#items = []; this.#undo = []; this.#redo = []; this.visible = true; }
}
