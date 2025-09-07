/**
 * GCodeEditor
 * Handles line DOM, editing behaviors, commands, and event binding inside the drawer body.
 */

import { sanitizeText, sanitizeContentEditable } from '../../utils/Sanitize.js';

export class GCodeEditor {
  constructor(bodyEl, {
    undoSystem,
    editMode = false, // boolean: false = Select mode, true = Edit mode
    onLineEdited, // function(force:boolean)
    onHover, onLeave, onClick, // functions(lineNum, ...)
    onDeleteLine, onBulkDelete, // functions
    getSelection, // () => Set<number>
    applySelection, // (Set|Array<number>) => void, also updates visuals
    updateLineCount // () => void
  }) {
    this.bodyEl = bodyEl;
    this.undoSystem = undoSystem;
    this.editMode = editMode;
    this.onLineEdited = onLineEdited;
    this.onHover = onHover;
    this.onLeave = onLeave;
    this.onClick = onClick;
    this.onDeleteLine = onDeleteLine;
    this.onBulkDelete = onBulkDelete;
    this.getSelection = getSelection;
    this.applySelection = applySelection;
    this.updateLineCount = updateLineCount;

    this.currentlyEditingLine = null;
    this.editingOriginalText = new Map();
  }

  updateSelectionClasses(selected) {
    const set = selected instanceof Set ? selected : new Set(selected || []);
    this.bodyEl.querySelectorAll('.gcode-line').forEach(el => el.classList.remove('selected'));
    set.forEach(lineNum => {
      const lineEl = this.bodyEl.querySelector(`.gcode-line[data-line="${lineNum}"]`);
      if (lineEl) lineEl.classList.add('selected');
    });
  }

  // Public API
  setLines(lines) {
    this.bodyEl.innerHTML = '';
    (lines || []).forEach((t, i) => {
      const lineNum = i + 1;
      const el = this._createLineElement(lineNum, t || '');
      this.bodyEl.appendChild(el);
    });
    this.updateLineCount?.();
  }

  rebindLineEvents() {
    try {
      this.bodyEl.querySelectorAll('.gcode-line').forEach(div => {
        const lineNum = parseInt(div.dataset.line);
        if (!isNaN(lineNum)) {
          const newDiv = div.cloneNode(true);
          div.parentNode.replaceChild(newDiv, div);
          this._bindLineEvents(newDiv, lineNum);
        }
      });
    } catch (e) {
      console.error('Error rebinding line events:', e);
    }
  }

  getText() {
    const parts = [];
    this.bodyEl.querySelectorAll('.gcode-line').forEach(el => {
      parts.push(el.querySelector('.gcode-line-text').textContent || '');
    });
    return parts.join('\n');
  }

  setEditMode(enabled) {
    this.editMode = enabled;
    
    // Update contentEditable on all existing text spans
    this.bodyEl.querySelectorAll('.gcode-line-text').forEach(el => {
      el.contentEditable = enabled;
    });

    // Rebind events to apply new mode conditionally
    this.rebindLineEvents();
  }

  // Commands
  createDeleteCommand(lineNums, linesData) {
    return {
      type: 'delete',
      execute: () => {
        lineNums.forEach(lineNum => {
          const lineEl = this.bodyEl.querySelector(`.gcode-line[data-line="${lineNum}"]`);
          if (lineEl) lineEl.remove();
        });
        this.applySelection(new Set());
        this._renumberLines();
        this.updateLineCount?.();
      },
      undo: () => {
        linesData.forEach(({ lineNum, text, originalIndex }) => {
          const div = this._createLineElement(lineNum, text);
          const allLines = Array.from(this.bodyEl.querySelectorAll('.gcode-line'));
          if (originalIndex < allLines.length) {
            this.bodyEl.insertBefore(div, allLines[originalIndex]);
          } else {
            this.bodyEl.appendChild(div);
          }
        });
        this._renumberLines();
        this.updateLineCount?.();
      }
    };
  }

  createInsertCommand(insertAfterLine, insertedLines) {
    const startLine = insertAfterLine + 1;
    const doInsert = () => {
      const fragment = document.createDocumentFragment();
      insertedLines.forEach((text, i) => {
        const div = this._createLineElement(startLine + i, text);
        fragment.appendChild(div);
      });
      const all = Array.from(this.bodyEl.querySelectorAll('.gcode-line'));
      const target = all[insertAfterLine] || null;
      if (target) this.bodyEl.insertBefore(fragment, target);
      else this.bodyEl.appendChild(fragment);
      this._renumberLines();
      this.updateLineCount?.();
      const sel = [];
      for (let n = 0; n < insertedLines.length; n++) sel.push(startLine + n);
      this.applySelection(sel);
    };
    const doRemove = () => {
      for (let n = insertedLines.length - 1; n >= 0; n--) {
        const lineEl = this.bodyEl.querySelector(`.gcode-line[data-line="${startLine + n}"]`);
        if (lineEl) lineEl.remove();
      }
      this._renumberLines();
      this.updateLineCount?.();
      this.applySelection(new Set());
    };
    return { type: 'insert', startLine, lineCount: insertedLines.length, execute: doInsert, undo: doRemove };
  }

  createMoveCommand(fromIndices, direction) {
    const originalLines = [...fromIndices];
    return {
      type: 'move',
      fromIndices: originalLines,
      direction,
      execute: () => {
        this.applySelection(originalLines.map(n => n + direction));
        this._moveSelectedLinesInternal(direction);
      },
      undo: () => {
        this.applySelection(originalLines.map(n => n + direction));
        this._moveSelectedLinesInternal(-direction);
        this.applySelection(originalLines);
      }
    };
  }

  createEditCommand(lineNum, oldText, newText) {
    return {
      type: 'edit', lineNum, oldText, newText,
      execute: () => {
        const lineEl = this.bodyEl.querySelector(`.gcode-line[data-line="${lineNum}"]`);
        if (!lineEl) return;
        const textEl = lineEl.querySelector('.gcode-line-text');
        if (!textEl) return;
        textEl.textContent = newText;
        this._markLineAsChanged(lineNum);
      },
      undo: () => {
        const lineEl = this.bodyEl.querySelector(`.gcode-line[data-line="${lineNum}"]`);
        if (!lineEl) return;
        const textEl = lineEl.querySelector('.gcode-line-text');
        if (!textEl) return;
        textEl.textContent = oldText;
        this._markLineAsChanged(lineNum);
      }
    };
  }

  // Internals
  _renumberLines() {
    this.bodyEl.querySelectorAll('.gcode-line').forEach((el, idx) => {
      const newNum = idx + 1;
      el.dataset.line = String(newNum);
      const numEl = el.querySelector('.gcode-line-num');
      if (numEl) numEl.textContent = String(newNum);
    });
  }

  _moveSelectedLinesInternal(direction) {
    const selected = Array.from(this.getSelection?.() || []).sort((a, b) => a - b);
    if (selected.length === 0) return;
    try {
      const allLines = Array.from(this.bodyEl.querySelectorAll('.gcode-line'));
      const lineCount = allLines.length;
      if (direction === -1 && selected[0] <= 1) return;
      if (direction === 1 && selected[selected.length - 1] >= lineCount) return;
      const elementsToMove = selected.map(n => this.bodyEl.querySelector(`.gcode-line[data-line="${n}"]`)).filter(Boolean);
      if (elementsToMove.length === 0) return;
      const fragment = document.createDocumentFragment();
      const elementsData = elementsToMove.map(el => ({
        content: el.querySelector('.gcode-line-text').textContent,
        lineNum: parseInt(el.dataset.line)
      }));
      let targetIndex;
      if (direction === -1) targetIndex = Math.max(0, selected[0] - 2);
      else targetIndex = Math.min(lineCount - elementsToMove.length, selected[selected.length - 1]);
      elementsToMove.forEach(el => el.remove());
      const remainingLines = Array.from(this.bodyEl.querySelectorAll('.gcode-line'));
      elementsData.forEach(data => {
        const newElement = this._createLineElement(data.lineNum + direction, data.content);
        fragment.appendChild(newElement);
      });
      const targetElement = remainingLines[targetIndex];
      if (targetElement) this.bodyEl.insertBefore(fragment, targetElement);
      else this.bodyEl.appendChild(fragment);
      const newSel = selected.map(n => n + direction);
      this.applySelection(newSel);
      this._renumberLines();
    } catch (e) {
      console.error('Error moving selected lines:', e);
    }
  }

  _markLineAsChanged(lineNum) {
    const lineEl = this.bodyEl.querySelector(`.gcode-line[data-line="${lineNum}"]`);
    if (lineEl) lineEl.classList.add('has-changes');
  }

  _setCurrentlyEditing(lineNum) {
    if (this.currentlyEditingLine !== null) {
      const prevLineEl = this.bodyEl.querySelector(`.gcode-line[data-line="${this.currentlyEditingLine}"]`);
      if (prevLineEl) prevLineEl.classList.remove('editing');
    }
    this.currentlyEditingLine = lineNum;
    if (lineNum !== null) {
      const lineEl = this.bodyEl.querySelector(`.gcode-line[data-line="${lineNum}"]`);
      if (lineEl) lineEl.classList.add('editing');
    }
  }

  _clearChangeIndicators() {
    this.bodyEl.querySelectorAll('.gcode-line.has-changes').forEach(el => el.classList.remove('has-changes'));
  }

  _createLineElement(lineNum, textContent) {
    const div = document.createElement('div');
    div.className = 'gcode-line';
    div.dataset.line = String(lineNum);

    const lineNumSpan = document.createElement('span');
    lineNumSpan.className = 'gcode-line-num';
    lineNumSpan.textContent = String(lineNum);

    const textSpan = document.createElement('span');
    textSpan.className = 'gcode-line-text';
    textSpan.contentEditable = this.editMode;
    textSpan.textContent = textContent || '';

    const delBtn = document.createElement('button');
    delBtn.className = 'gcode-del';
    delBtn.title = 'Delete line';
    delBtn.setAttribute('aria-label', 'Delete line');
    delBtn.textContent = '×';

    div.appendChild(lineNumSpan);
    div.appendChild(textSpan);
    div.appendChild(delBtn);

    this._bindLineEvents(div, lineNum);
    return div;
  }

  _bindLineEvents(lineElement, lineNum) {
    try {
      // Hover events (always active)
      lineElement.addEventListener('mouseenter', () => this.onHover?.(lineNum));
      lineElement.addEventListener('mouseleave', () => this.onLeave?.(lineNum));
      
      // Click events for selection (only in Select mode)
      lineElement.addEventListener('click', (e) => {
        if (e.target && e.target.classList?.contains('gcode-del')) return;
        
        // In Edit mode, skip selection - let text editing handle clicks
        if (this.editMode) return;
        
        this.onClick?.(lineNum, lineElement, e);
      });

      const txtEl = lineElement.querySelector('.gcode-line-text');
      if (txtEl && this.editMode) {
        // Editing events (only in Edit mode)
        txtEl.addEventListener('input', (e) => {
          sanitizeContentEditable(e.target);
          this._markLineAsChanged(lineNum);
          this.onLineEdited?.(false);
        });
        txtEl.addEventListener('focus', (e) => {
          const originalText = e.target.textContent || '';
          this.editingOriginalText.set(lineNum, originalText);
          this._setCurrentlyEditing(lineNum);
        });
        txtEl.addEventListener('blur', (e) => {
          sanitizeContentEditable(e.target);
          const currentText = e.target.textContent || '';
          const originalText = this.editingOriginalText.get(lineNum);
          if (originalText !== undefined && originalText !== currentText) {
            const editCmd = this.createEditCommand(lineNum, originalText, currentText);
            this.undoSystem.push(editCmd);
          }
          this.editingOriginalText.delete(lineNum);
          this._setCurrentlyEditing(null);
          this.onLineEdited?.(true);
        });
        txtEl.addEventListener('paste', (e) => {
          e.preventDefault();
          const paste = (e.clipboardData || window.clipboardData).getData('text/plain');
          const sanitized = sanitizeText(paste);
          document.execCommand('insertText', false, sanitized);
          this._markLineAsChanged(lineNum);
        });
      }

      const delBtn = lineElement.querySelector('.gcode-del');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const sel = this.getSelection?.() || new Set();
          if (sel.has(lineNum) && sel.size > 1) {
            this.onBulkDelete?.();
          } else {
            this.onDeleteLine?.(lineNum);
          }
        });
      }
    } catch (error) {
      console.error('Error binding events for line', lineNum, ':', error);
    }
  }
}

export default GCodeEditor;
