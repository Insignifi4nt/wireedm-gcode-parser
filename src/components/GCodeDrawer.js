/**
 * GCodeDrawer Component
 * Collapsible panel that shows raw G-code, supports hover/click highlight,
 * and inserts measurement points at a chosen line.
 */

import { EventBus } from '../core/EventManager.js';

export class GCodeDrawer {
  constructor(mountTarget = document.body, options = {}) {
    this.eventBus = EventBus.getInstance();
    this.options = { anchor: 'right', ...options };
    this.container = document.createElement('div');
    this.container.className = 'gcode-drawer';
    this.headerEl = null;
    this.bodyEl = null;
    this.footerEl = null;
    this.lines = []; // [{num, text, indexMapping}]
    this.lineIndexToPathIndex = new Map(); // source line -> path index
    this.selectedLine = null;
    this._debounceTimer = null;
    mountTarget.appendChild(this.container);
    this._render();
    this._bindGlobalEvents();
  }

  _render() {
    this.container.innerHTML = `
      <div class="gcode-drawer-header">
        <strong>G-Code</strong>
        <div>
          <button class="gcode-insert-btn" data-action="insert-points" title="Insert clicked points at selected line">Insert G0 Moves Here</button>
          <button class="gcode-insert-btn" data-action="close">Close</button>
        </div>
      </div>
      <div class="gcode-drawer-body" tabindex="0"></div>
      <div class="gcode-drawer-footer">
        <span>Hover a line to preview. Click to select.</span>
      </div>
    `;
    this.headerEl = this.container.querySelector('.gcode-drawer-header');
    this.bodyEl = this.container.querySelector('.gcode-drawer-body');
    this.footerEl = this.container.querySelector('.gcode-drawer-footer');

    // Events
    this.container.querySelector('[data-action="close"]').addEventListener('click', () => this.toggle(false));
    this.container.querySelector('[data-action="insert-points"]').addEventListener('click', () => {
      const atIndex = this.selectedLine != null ? (this.lineIndexToPathIndex.get(this.selectedLine) ?? null) : null;
      this.eventBus.emit('drawer:insert:points', { atIndex, points: this._getClickedPointsFromApp() }, { skipValidation: true });
    });
  }

  _bindGlobalEvents() {
    // Toggle
    this.eventBus.on('drawer:toggle', () => this.toggle());
  }

  toggle(force) {
    const isOpen = this.container.classList.contains('open');
    const next = typeof force === 'boolean' ? force : !isOpen;
    this.container.classList.toggle('open', next);
  }

  setContent({ text, mapping }) {
    // mapping: [{index, line, point}]
    this.bodyEl.innerHTML = '';
    this.lines = [];
    this.lineIndexToPathIndex.clear();
    const rawLines = (text || '').split(/\r?\n/);
    rawLines.forEach((t, i) => {
      const lineNum = i + 1;
      const div = document.createElement('div');
      div.className = 'gcode-line';
      div.dataset.line = String(lineNum);
      div.innerHTML = `
        <span class="gcode-line-num">${lineNum}</span>
        <span class="gcode-line-text" contenteditable="true">${t.replace(/</g,'&lt;')}</span>
        <button class="gcode-del" title="Delete line" aria-label="Delete line">×</button>
      `;
      div.addEventListener('mouseenter', () => this._onHover(lineNum));
      div.addEventListener('mouseleave', () => this._onLeave(lineNum));
      div.addEventListener('click', (e) => {
        if ((e.target && e.target.classList?.contains('gcode-del'))) return;
        this._onClick(lineNum, div);
      });
      const txtEl = div.querySelector('.gcode-line-text');
      txtEl.addEventListener('input', () => this._onLineEdited());
      txtEl.addEventListener('blur', () => this._onLineEdited(true));
      div.querySelector('.gcode-del').addEventListener('click', (e) => {
        e.stopPropagation();
        this._onDelete(lineNum);
      });
      this.bodyEl.appendChild(div);
      this.lines.push({ num: lineNum, text: t });
    });
    // Build line->path index map (use first point with matching line)
    mapping?.forEach(m => {
      if (m.line) {
        if (!this.lineIndexToPathIndex.has(m.line)) {
          this.lineIndexToPathIndex.set(m.line, m.index);
        }
      }
    });
  }

  _onHover(lineNum) {
    const index = this.lineIndexToPathIndex.get(lineNum);
    if (index != null) {
      this.eventBus.emit('drawer:line:hover', { index }, { skipValidation: true });
    }
  }

  _onLeave(_lineNum) {
    this.eventBus.emit('drawer:line:leave', {}, { skipValidation: true });
  }

  _onClick(lineNum, element) {
    // Select row
    this.bodyEl.querySelectorAll('.gcode-line.selected').forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');
    this.selectedLine = lineNum;
    const index = this.lineIndexToPathIndex.get(lineNum);
    if (index != null) {
      this.eventBus.emit('drawer:line:click', { index }, { skipValidation: true });
    }
  }

  insertPointsAt(atIndex, points) {
    // If the line is not mapped to a path index, append at current selected line position in text
    const gcodeText = this.getText();
    const insertAfterLine = this.selectedLine || 1;
    const lines = gcodeText.split(/\r?\n/);
    const gcodeForPoints = points.map((p, idx) => `; inserted G0 P${idx + 1}\nG0 X${p.x.toFixed(3)} Y${p.y.toFixed(3)}`).join('\n');
    const before = lines.slice(0, insertAfterLine).join('\n');
    const after = lines.slice(insertAfterLine).join('\n');
    const newText = `${before}\n${gcodeForPoints}\n${after}`.replace(/\n\n\n/g, '\n\n');
    this._emitContentChanged(newText);
  }

  getText() {
    // Recreate text from DOM to preserve any edits in future extension
    const parts = [];
    this.bodyEl.querySelectorAll('.gcode-line').forEach(el => {
      parts.push(el.querySelector('.gcode-line-text').textContent || '');
    });
    return parts.join('\n');
  }

  _getClickedPointsFromApp() {
    // Peek global app instance for now; future: pass via event
    const app = window.wireEDMViewer;
    return app?.clickedPoints || [];
  }

  _onLineEdited(force = false) {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    const fire = () => this._emitContentChanged(this.getText());
    if (force) {
      fire();
    } else {
      this._debounceTimer = setTimeout(fire, 300);
    }
  }

  _onDelete(lineNum) {
    const lineEl = this.bodyEl.querySelector(`.gcode-line[data-line="${lineNum}"]`);
    if (!lineEl) return;
    lineEl.remove();
    this.bodyEl.querySelectorAll('.gcode-line').forEach((el, idx) => {
      const newNum = idx + 1;
      el.dataset.line = String(newNum);
      const numEl = el.querySelector('.gcode-line-num');
      if (numEl) numEl.textContent = String(newNum);
    });
    this._emitContentChanged(this.getText());
  }

  _emitContentChanged(text) {
    this.eventBus.emit('drawer:content:changed', { text }, { skipValidation: true });
  }
}

export default GCodeDrawer;


