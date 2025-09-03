/**
 * MultiSelectHandler
 * Encapsulates selection state and core selection operations.
 */

export class MultiSelectHandler {
  constructor(initialSelection = null) {
    this._set = new Set();
    if (initialSelection) this.setSelection(initialSelection);
  }

  clear() {
    this._set.clear();
    return this;
  }

  selectSingle(n) {
    this._set.clear();
    if (Number.isFinite(n)) this._set.add(n);
    return this;
  }

  toggle(n) {
    if (!Number.isFinite(n)) return this;
    if (this._set.has(n)) this._set.delete(n);
    else this._set.add(n);
    return this;
  }

  selectRange(a, b) {
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    this._set.clear();
    for (let i = start; i <= end; i++) this._set.add(i);
    return this;
  }

  setSelection(sel) {
    this._set.clear();
    if (!sel) return this;
    const iter = sel instanceof Set ? sel.values() : Array.isArray(sel) ? sel.values() : null;
    if (!iter) return this;
    for (const v of iter) {
      if (Number.isFinite(v)) this._set.add(v);
    }
    return this;
  }

  getSelection() {
    // Return a copy to avoid external mutation of internal state
    return new Set(this._set);
  }

  has(n) {
    return this._set.has(n);
  }

  size() {
    return this._set.size;
  }
}

export default MultiSelectHandler;

