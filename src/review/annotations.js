const clone = value => structuredClone(value);
const round = value => Math.round(value * 1e6) / 1e6;
const TYPES = new Set(['ink', 'highlight', 'underline', 'strikeout', 'note', 'freetext']);

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
    this.#record();
    const item = { id: annotation.id || crypto.randomUUID(), createdAt: annotation.createdAt || new Date().toISOString(), ...clone(annotation) };
    this.#items.push(item);
    return clone(item);
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
