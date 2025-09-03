/**
 * GCodeDrawer Component
 * Collapsible panel that shows raw G-code, supports hover/click highlight,
 * and inserts measurement points at a chosen line.
 */

import { EventBus, EVENT_TYPES } from '../core/EventManager.js';
import { sanitizeText, sanitizeContentEditable } from '../utils/Sanitize.js';
import { UndoRedoSystem } from './drawer/UndoRedoSystem.js';
import { MultiSelectHandler } from './drawer/MultiSelectHandler.js';
import { DrawerToolbar } from './drawer/DrawerToolbar.js';
import { GCodeEditor } from './drawer/GCodeEditor.js';

export class GCodeDrawer {
  constructor(mountTarget = document.body, options = {}) {
    this.eventBus = EventBus.getInstance();
    this.options = { anchor: 'right', debug: false, ...options };
    this.container = document.createElement('div');
    this.container.className = 'gcode-drawer';
    this.headerEl = null;
    this.bodyEl = null;
    this.footerEl = null;
    this.toolbar = null;
    this.editor = null;
    this.lines = []; // [{num, text, indexMapping}]
    this.lineIndexToPathIndex = new Map(); // source line -> path index
    this.pathIndexToLineIndex = new Map(); // path index -> source line
    this.selectedLines = new Set(); // Set of selected line numbers (mirrors selection handler)
    this.selection = new MultiSelectHandler();
    this.lastClickedLine = null; // For shift-click range selection
    this._debounceTimer = null;
    this.linesWithChanges = new Set(); // Track lines with unsaved changes
    this.currentlyEditingLine = null; // Track currently focused line
    this.editingOriginalText = new Map(); // Track original text when editing starts
    this.maxHistorySize = 50; // Limit history size
    this.undoSystem = new UndoRedoSystem({ max: this.maxHistorySize, onChange: () => this._updateUndoRedoButtons() });
    mountTarget.appendChild(this.container);
    this._applyAnchorClass();
    this._render();
    this._bindGlobalEvents();
  }

  _applyAnchorClass() {
    const anchor = (this.options.anchor === 'left') ? 'left' : 'right';
    this.container.classList.remove('gcode-drawer--left', 'gcode-drawer--right');
    this.container.classList.add(`gcode-drawer--${anchor}`);
  }

  _debug(...args) {
    if (this.options.debug) {
      console.log('[GCodeDrawer]', ...args);
    }
  }

  _render() {
    this.container.innerHTML = `
      <div class="gcode-drawer-body" tabindex="0"></div>
      <div class="gcode-drawer-footer">
        <div class="gcode-help-text">Hover to preview • Click to select • Ctrl+click for multi-select</div>
      </div>
    `;
    // Render toolbars via DrawerToolbar
    this.toolbar = new DrawerToolbar(this.container, {
      onClose: () => this.toggle(false),
      onUndo: () => this._undo(),
      onRedo: () => this._redo(),
      onMoveUp: () => this._moveSelectedLines(-1),
      onMoveDown: () => this._moveSelectedLines(1),
      onInsertPoints: async () => {
        try {
          const firstSelected = this.selectedLines.size > 0 ? Math.min(...this.selectedLines) : null;
          const atIndex = firstSelected != null ? (this.lineIndexToPathIndex.get(firstSelected) ?? null) : null;
          const points = await this._getClickedPointsFromApp();
          this.eventBus.emit('drawer:insert:points', { atIndex, points }, { skipValidation: true });
        } catch (error) {
          console.error('Error inserting points:', error);
        }
      },
      onDeleteSelected: () => this._onBulkDelete()
    });
    this.headerEl = this.container.querySelector('.gcode-drawer-header');
    this.bodyEl = this.container.querySelector('.gcode-drawer-body');
    this.footerEl = this.container.querySelector('.gcode-drawer-footer');
    
    // Add keyboard event handling
    this.bodyEl.addEventListener('keydown', (e) => this._onKeyDown(e));

    // Initialize editor for line DOM and editing behaviors
    this.editor = new GCodeEditor(this.bodyEl, {
      undoSystem: this.undoSystem,
      onLineEdited: (force) => this._onLineEdited(force),
      onHover: (lineNum) => this._onHover(lineNum),
      onLeave: (lineNum) => this._onLeave(lineNum),
      onClick: (lineNum, element, event) => this._onClick(lineNum, element, event),
      onDeleteLine: (lineNum) => this._onDelete(lineNum),
      onBulkDelete: () => this._onBulkDelete(),
      getSelection: () => this.selectedLines,
      applySelection: (sel) => {
        const next = sel instanceof Set ? sel : new Set(sel || []);
        this.selection.setSelection(next);
        this.selectedLines = this.selection.getSelection();
        this._updateSelectionVisuals();
      },
      updateLineCount: () => this._updateLineCount()
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

  setContent({ text, mapping, preserveHistory = false }) {
    // mapping: [{index, line, point}]
    this.bodyEl.innerHTML = '';
    this.lines = [];
    this.lineIndexToPathIndex.clear();
    this.pathIndexToLineIndex.clear();
    this.selection.clear();
    this.selectedLines = this.selection.getSelection();
    this.lastClickedLine = null;
    this.linesWithChanges.clear();
    this.currentlyEditingLine = null;
    this.editingOriginalText.clear();
    
    // Only clear undo/redo history if preserveHistory is false
    if (!preserveHistory) {
      console.log('GCodeDrawer: Clearing undo/redo history');
      this.undoSystem.clear();
    } else {
      console.log('GCodeDrawer: Preserving undo/redo history, stack sizes:', this.undoSystem.getUndoCount(), this.undoSystem.getRedoCount());
    }
    const rawLines = (text || '').split(/\r?\n/);
    this.editor.setLines(rawLines);
    this.lines = rawLines.map((t, i) => ({ num: i + 1, text: t }));
    // Build line->path index map (use first point with matching line)
    mapping?.forEach(m => {
      if (typeof m?.line === 'number' && typeof m?.index === 'number') {
        if (!this.lineIndexToPathIndex.has(m.line)) {
          this.lineIndexToPathIndex.set(m.line, m.index);
        }
        if (!this.pathIndexToLineIndex.has(m.index)) {
          this.pathIndexToLineIndex.set(m.index, m.line);
        }
      }
    });
    
    // Update line count display
    this._updateLineCount();
    
    // Initialize undo/redo buttons
    this._updateUndoRedoButtons();
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

  _onClick(lineNum, element, event) {
    if (event.shiftKey && this.lastClickedLine != null) {
      // Range selection
      this._selectRange(Math.min(this.lastClickedLine, lineNum), Math.max(this.lastClickedLine, lineNum));
    } else if (event.ctrlKey || event.metaKey) {
      // Toggle selection
      this._toggleSelection(lineNum, element);
    } else {
      // Single selection
      this._selectSingle(lineNum, element);
    }
    
    this.lastClickedLine = lineNum;
    this._updateSelectionVisuals();
    
    // Emit click event for first selected line (maintain compatibility)
    const firstSelected = Math.min(...this.selectedLines);
    const index = this.lineIndexToPathIndex.get(firstSelected);
    if (index != null) {
      this.eventBus.emit('drawer:line:click', { index }, { skipValidation: true });
    }
  }

  _selectSingle(lineNum, element) {
    this.selection.selectSingle(lineNum);
    this.selectedLines = this.selection.getSelection();
  }

  _toggleSelection(lineNum, element) {
    this.selection.setSelection(this.selectedLines).toggle(lineNum);
    this.selectedLines = this.selection.getSelection();
  }

  _selectRange(startLine, endLine) {
    this.selection.selectRange(startLine, endLine);
    this.selectedLines = this.selection.getSelection();
  }

  _updateSelectionVisuals() {
    // Clear all selected states
    this.bodyEl.querySelectorAll('.gcode-line.selected').forEach(el => el.classList.remove('selected'));
    
    // Apply selected state to selected lines
    this.selectedLines.forEach(lineNum => {
      const lineEl = this.bodyEl.querySelector(`.gcode-line[data-line="${lineNum}"]`);
      if (lineEl) {
        lineEl.classList.add('selected');
      }
    });
    
    const count = this.selectedLines.size;
    const hasSelection = count > 0;
    
    // Delegate to toolbar for visibility and enablement
    if (this.toolbar) this.toolbar.updateSelectionUI(hasSelection, count);
  }
  
  _restoreSelection(lineNumbers) {
    // Helper method to restore selection to specific line numbers
    console.log('GCodeDrawer: Restoring selection to lines:', lineNumbers);
    const valid = [];
    lineNumbers.forEach(lineNum => {
      const lineEl = this.bodyEl.querySelector(`.gcode-line[data-line="${lineNum}"]`);
      if (lineEl) valid.push(lineNum);
    });
    this.selection.setSelection(valid);
    this.selectedLines = this.selection.getSelection();
    this._updateSelectionVisuals();
  }
  
  _updateLineCount() {
    const count = this.bodyEl ? this.bodyEl.querySelectorAll('.gcode-line').length : this.lines.length;
    if (this.toolbar) this.toolbar.updateLineCount(count);
  }
  
  _markLineAsChanged(lineNum) {
    this.linesWithChanges.add(lineNum);
    const lineEl = this.bodyEl.querySelector(`.gcode-line[data-line="${lineNum}"]`);
    if (lineEl) {
      lineEl.classList.add('has-changes');
    }
  }
  
  _setCurrentlyEditing(lineNum) {
    // Remove editing class from previous line
    if (this.currentlyEditingLine !== null) {
      const prevLineEl = this.bodyEl.querySelector(`.gcode-line[data-line="${this.currentlyEditingLine}"]`);
      if (prevLineEl) {
        prevLineEl.classList.remove('editing');
      }
    }
    
    // Set new editing line
    this.currentlyEditingLine = lineNum;
    
    // Add editing class to current line
    if (lineNum !== null) {
      const lineEl = this.bodyEl.querySelector(`.gcode-line[data-line="${lineNum}"]`);
      if (lineEl) {
        lineEl.classList.add('editing');
      }
    }
  }
  
  _clearChangeIndicators() {
    // Clear all change indicators when content is saved
    this.linesWithChanges.clear();
    this.bodyEl.querySelectorAll('.gcode-line.has-changes').forEach(el => {
      el.classList.remove('has-changes');
    });
  }
  
  // Undo/Redo functionality
  _undo() {
    if (!this.undoSystem.canUndo()) return;
    // Cancel any pending debounced content change to avoid racing updates
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    const command = this.undoSystem.undo();
    if (!command) return;
    this._debug('Executed undo for command:', command.type);
    
    // For move commands, preserve selection after content change
    if (command.type === 'move') {
      const movedSelection = Array.from(this.selectedLines);
      this._emitContentChanged(this.getText());
      setTimeout(() => {
        this._restoreSelection(movedSelection);
      }, 0);
    } else {
      this._emitContentChanged(this.getText());
    }
  }
  
  _redo() {
    if (!this.undoSystem.canRedo()) return;
    // Cancel any pending debounced content change to avoid racing updates
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    const command = this.undoSystem.redo();
    if (!command) return;
    this._debug('Executed redo for command:', command.type);
    
    // For move commands, preserve selection after content change
    if (command.type === 'move') {
      const movedSelection = Array.from(this.selectedLines);
      this._emitContentChanged(this.getText());
      setTimeout(() => {
        this._restoreSelection(movedSelection);
      }, 0);
    } else {
      this._emitContentChanged(this.getText());
    }
  }
  
  _updateUndoRedoButtons() {
    const undoCount = this.undoSystem.getUndoCount();
    const redoCount = this.undoSystem.getRedoCount();
    this._debug('Updating undo/redo buttons. Undo stack:', undoCount, 'Redo stack:', redoCount);
    if (this.toolbar) this.toolbar.setUndoRedoState(undoCount, redoCount);
  }
  
  // Command classes for undo/redo
  _createDeleteCommand(lineNums, linesData) {
    return {
      type: 'delete',
      execute: () => {
        // Delete lines (this is the original action)
        lineNums.forEach(lineNum => {
          const lineEl = this.bodyEl.querySelector(`.gcode-line[data-line="${lineNum}"]`);
          if (lineEl) lineEl.remove();
        });
        this.selection.clear();
        this.selectedLines = this.selection.getSelection();
        this._renumberLines();
        this._updateLineCount();
        this._updateSelectionVisuals();
      },
      undo: () => {
        // Restore deleted lines
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
        this._updateLineCount();
        this._updateSelectionVisuals();
      }
    };
  }
  
  _createInsertCommand(insertAfterLine, insertedLines) {
    // insertAfterLine: number (line number after which to insert), 0 inserts at top
    // insertedLines: array of strings (each a line to insert)
    const startLine = insertAfterLine + 1; // first inserted line number at time of execute

    const doInsert = () => {
      // Build fragment with new lines and insert at target index
      const fragment = document.createDocumentFragment();
      insertedLines.forEach((text, i) => {
        const div = this._createLineElement(startLine + i, text);
        fragment.appendChild(div);
      });

      const all = Array.from(this.bodyEl.querySelectorAll('.gcode-line'));
      const target = all[insertAfterLine] || null; // insert before the element currently at this index (append if null)
      if (target) {
        this.bodyEl.insertBefore(fragment, target);
      } else {
        this.bodyEl.appendChild(fragment);
      }

      // Renumber and update UI
      this._renumberLines();
      this._updateLineCount();

      // Select the newly inserted range
      const sel = [];
      for (let n = 0; n < insertedLines.length; n++) sel.push(startLine + n);
      this.selection.setSelection(sel);
      this.selectedLines = this.selection.getSelection();
      this._updateSelectionVisuals();
    };

    const doRemove = () => {
      // Remove the exact range that was inserted
      for (let n = insertedLines.length - 1; n >= 0; n--) {
        const lineEl = this.bodyEl.querySelector(`.gcode-line[data-line="${startLine + n}"]`);
        if (lineEl) lineEl.remove();
      }
      this._renumberLines();
      this._updateLineCount();
      this.selection.clear();
      this.selectedLines = this.selection.getSelection();
      this._updateSelectionVisuals();
    };

    return {
      type: 'insert',
      startLine,
      lineCount: insertedLines.length,
      execute: () => doInsert(),
      undo: () => doRemove()
    };
  }
  
  _createMoveCommand(fromIndices, direction) {
    // Store original line positions
    const originalLines = [...fromIndices];
    
    return {
      type: 'move',
      fromIndices: originalLines,
      direction: direction,
      execute: () => {
        // For redo operations, restore selection and move
        this._debug('Move command execute, restoring selection to lines:', originalLines.map(n => n + direction));
        this._restoreSelection(originalLines.map(lineNum => lineNum + direction));
        this._moveSelectedLinesInternal(direction);
      },
      undo: () => {
        // For undo operations, restore selection to moved positions and move back
        this._debug('Move command undo, restoring selection to lines:', originalLines.map(n => n + direction));
        this._restoreSelection(originalLines.map(lineNum => lineNum + direction));
        this._moveSelectedLinesInternal(-direction);
        // After undo, restore original selection
        this._restoreSelection(originalLines);
      }
    };
  }
  
  _createEditCommand(lineNum, oldText, newText) {
    return {
      type: 'edit',
      lineNum: lineNum,
      oldText: oldText,
      newText: newText,
      execute: () => {
        // Apply new text
        const lineEl = this.bodyEl.querySelector(`.gcode-line[data-line="${lineNum}"]`);
        if (lineEl) {
          const textEl = lineEl.querySelector('.gcode-line-text');
          if (textEl) {
            textEl.textContent = newText;
            this._markLineAsChanged(lineNum);
          }
        }
      },
      undo: () => {
        // Restore old text
        const lineEl = this.bodyEl.querySelector(`.gcode-line[data-line="${lineNum}"]`);
        if (lineEl) {
          const textEl = lineEl.querySelector('.gcode-line-text');
          if (textEl) {
            textEl.textContent = oldText;
            this._markLineAsChanged(lineNum);
          }
        }
      }
    };
  }

  insertPointsAt(atIndex, points) {
    // Insert generated G-code for points after a resolved line:
    // Priority: path index -> source line; fallback to first selected; fallback to line 1.
    if (!Array.isArray(points) || points.length === 0) return;

    const gcodeText = this.getText();
    let insertAfterLine = null;

    if (typeof atIndex === 'number' && this.pathIndexToLineIndex.has(atIndex)) {
      insertAfterLine = this.pathIndexToLineIndex.get(atIndex);
    }

    if (insertAfterLine == null) {
      insertAfterLine = this.selectedLines.size > 0 ? Math.min(...this.selectedLines) : 1;
    }

    const gcodeLines = points.flatMap((p, idx) => [
      `; inserted G0 P${idx + 1}`,
      `G0 X${p.x.toFixed(3)} Y${p.y.toFixed(3)}`
    ]);

    // Create and push undoable insert command
    const insertCommand = this.editor.createInsertCommand(insertAfterLine, gcodeLines);
    this.undoSystem.push(insertCommand);

    // Execute insertion immediately
    insertCommand.execute();

    // Emit updated content so main app can reparse, then restore selection
    const movedSelection = Array.from(this.selectedLines);
    this._emitContentChanged(this.getText());
    setTimeout(() => {
      this._restoreSelection(movedSelection);
    }, 0);
  }

  getText() {
    // Recreate text from DOM to preserve any edits in future extension
    const parts = [];
    this.bodyEl.querySelectorAll('.gcode-line').forEach(el => {
      parts.push(el.querySelector('.gcode-line-text').textContent || '');
    });
    return parts.join('\n');
  }

  async _getClickedPointsFromApp() {
    // Use event-based communication instead of global access
    return new Promise((resolve) => {
      // Set up one-time listener for the response
      const handleResponse = ({ points }) => {
        this.eventBus.off(EVENT_TYPES.POINT_CLICKED_RESPONSE, handleResponse);
        resolve(points || []);
      };
      
      this.eventBus.on(EVENT_TYPES.POINT_CLICKED_RESPONSE, handleResponse);
      
      // Request clicked points from main app
      this.eventBus.emit(EVENT_TYPES.POINT_GET_CLICKED, {}, { skipValidation: true });
      
      // Add timeout to prevent hanging
      setTimeout(() => {
        this.eventBus.off(EVENT_TYPES.POINT_CLICKED_RESPONSE, handleResponse);
        resolve([]);
      }, 1000);
    });
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
      // Increased debounce timeout to 3000ms to allow uninterrupted editing
      // Short debounce times (100ms) disrupt editing by constantly refreshing the drawer
      this._debounceTimer = setTimeout(fire, 3000);
    }
  }

  _onDelete(lineNum) {
    const lineEl = this.bodyEl.querySelector(`.gcode-line[data-line="${lineNum}"]`);
    if (!lineEl) return;
    
    // Cancel any pending debounced content change to avoid racing updates
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    // Capture state for undo
    const allLines = Array.from(this.bodyEl.querySelectorAll('.gcode-line'));
    const linesData = [{
      lineNum: lineNum,
      text: lineEl.querySelector('.gcode-line-text').textContent,
      originalIndex: allLines.indexOf(lineEl)
    }];
    
    // Create and push delete command
    const deleteCommand = this.editor.createDeleteCommand([lineNum], linesData);
    this.undoSystem.push(deleteCommand);
    
    // Execute delete
    deleteCommand.execute();
    
    // Update internal lines array
    this.lines = this.lines.filter(line => line.num !== lineNum);
    
    // Remove from selection if it was selected
    const nextSel = new Set(this.selectedLines);
    nextSel.delete(lineNum);
    this.selection.setSelection(nextSel);
    this.selectedLines = this.selection.getSelection();
    if (this.lastClickedLine === lineNum) {
      this.lastClickedLine = null;
    }
    
    this._emitContentChanged(this.getText());
  }

  _onKeyDown(e) {
    // If typing inside a line editor, let the browser handle undo/redo and edits
    if (e.target && (e.target.isContentEditable || e.target.closest?.('.gcode-line-text'))) {
      return;
    }

    // Handle keyboard shortcuts
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      switch (e.key.toLowerCase()) {
        case 'z':
          e.preventDefault();
          this._undo();
          return;
        case 'y':
          e.preventDefault();
          this._redo();
          return;
      }
    }
    
    // Handle Ctrl+Shift+Z as alternative redo (common shortcut)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      this._redo();
      return;
    }
    
    // Handle delete actions
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.selectedLines.size > 0) {
        e.preventDefault();
        this._onBulkDelete();
      }
    }

    // Escape clears selection
    if (e.key === 'Escape') {
      if (this.selectedLines.size > 0) {
        this.selection.clear();
        this.selectedLines = this.selection.getSelection();
        this._updateSelectionVisuals();
      }
    }
  }

  _onBulkDelete() {
    if (this.selectedLines.size === 0) return;
    
    // Cancel any pending debounced content change to avoid racing updates
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    // Show confirmation for bulk delete (>3 lines)
    const count = this.selectedLines.size;
    if (count > 3) {
      const confirmed = confirm(`Delete ${count} selected lines? Use Ctrl+Z to undo if needed.`);
      if (!confirmed) return;
    }
    
    // Capture current state for undo
    const sortedLines = Array.from(this.selectedLines).sort((a, b) => a - b);
    const linesData = sortedLines.map(lineNum => {
      const lineEl = this.bodyEl.querySelector(`.gcode-line[data-line="${lineNum}"]`);
      const allLines = Array.from(this.bodyEl.querySelectorAll('.gcode-line'));
      return {
        lineNum: lineNum,
        text: lineEl ? lineEl.querySelector('.gcode-line-text').textContent : '',
        originalIndex: allLines.indexOf(lineEl)
      };
    });
    
    // Create and push delete command
    const deleteCommand = this.editor.createDeleteCommand(sortedLines, linesData);
    this.undoSystem.push(deleteCommand);
    
    // Execute delete
    deleteCommand.execute();
    this._emitContentChanged(this.getText());
  }

  _renumberLines() {
    this.bodyEl.querySelectorAll('.gcode-line').forEach((el, idx) => {
      const newNum = idx + 1;
      el.dataset.line = String(newNum);
      const numEl = el.querySelector('.gcode-line-num');
      if (numEl) numEl.textContent = String(newNum);
    });
  }

  _moveSelectedLines(direction) {
    if (this.selectedLines.size === 0) return;
    
    // Cancel any pending debounced content change to avoid racing updates
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    const sortedSelection = Array.from(this.selectedLines).sort((a, b) => a - b);
    
    // Create and push move command
    const moveCommand = this.editor.createMoveCommand(sortedSelection, direction);
    this.undoSystem.push(moveCommand);
    
    // Execute initial move (selection is already correct)
    this.editor._moveSelectedLinesInternal(direction);
    
    // Store the moved selection to restore after setContent clears it
    const movedSelection = Array.from(this.selectedLines);
    
    // Emit content change (this will trigger main app to call setContent)
    this._emitContentChanged(this.getText());
    
    // Restore selection after a brief delay (after setContent has been called)
    setTimeout(() => {
      this._restoreSelection(movedSelection);
    }, 0);
  }
  
  _moveSelectedLinesInternal(direction) {
    if (this.selectedLines.size === 0) return;
    
    try {
      const allLines = Array.from(this.bodyEl.querySelectorAll('.gcode-line'));
      const sortedSelection = Array.from(this.selectedLines).sort((a, b) => a - b);
      const lineCount = allLines.length;
      
      // Validate move is possible
      if (direction === -1 && sortedSelection[0] <= 1) return;
      if (direction === 1 && sortedSelection[sortedSelection.length - 1] >= lineCount) return;
      
      // Get elements to move and validate they exist
      const elementsToMove = sortedSelection
        .map(lineNum => this.bodyEl.querySelector(`.gcode-line[data-line="${lineNum}"]`))
        .filter(Boolean);
      
      if (elementsToMove.length === 0) return;
      
      // Use DocumentFragment for efficient batch operations
      const fragment = document.createDocumentFragment();
      const elementsData = elementsToMove.map(el => ({
        element: el,
        content: el.querySelector('.gcode-line-text').textContent,
        lineNum: parseInt(el.dataset.line)
      }));
      
      // Calculate target position
      let targetIndex;
      if (direction === -1) {
        targetIndex = Math.max(0, sortedSelection[0] - 2);
      } else {
        targetIndex = Math.min(lineCount - elementsToMove.length, sortedSelection[sortedSelection.length - 1]);
      }
      
      // Remove elements temporarily
      elementsToMove.forEach(el => el.remove());
      
      // Get updated line list after removal
      const remainingLines = Array.from(this.bodyEl.querySelectorAll('.gcode-line'));
      
      // Rebuild elements in fragment
      elementsData.forEach((data, idx) => {
        const newElement = this._createLineElement(data.lineNum + direction, data.content);
        fragment.appendChild(newElement);
      });
      
      // Insert fragment at target position
      const targetElement = remainingLines[targetIndex];
      if (targetElement) {
        this.bodyEl.insertBefore(fragment, targetElement);
      } else {
        this.bodyEl.appendChild(fragment);
      }
      
      // Update selection to new positions
      const newSel = sortedSelection.map(lineNum => lineNum + direction);
      this.selection.setSelection(newSel);
      this.selectedLines = this.selection.getSelection();
      
      // Update UI state efficiently
      this._renumberLines();
      this._updateSelectionVisuals();
      
    } catch (error) {
      console.error('Error moving selected lines:', error);
      // Attempt to recover by refreshing content
      this._emitContentChanged(this.getText());
    }
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
    textSpan.contentEditable = 'true';
    // Use textContent for safe text assignment (auto-escapes HTML)
    textSpan.textContent = textContent || '';
    
    const delBtn = document.createElement('button');
    delBtn.className = 'gcode-del';
    delBtn.title = 'Delete line';
    delBtn.setAttribute('aria-label', 'Delete line');
    delBtn.textContent = '×';
    
    div.appendChild(lineNumSpan);
    div.appendChild(textSpan);
    div.appendChild(delBtn);
    
    // Bind events using centralized method
    this._bindLineEvents(div, lineNum);
    
    return div;
  }

  _bindLineEvents(lineElement, lineNum) {
    // Bind events for a single line element
    try {
      lineElement.addEventListener('mouseenter', () => this._onHover(lineNum));
      lineElement.addEventListener('mouseleave', () => this._onLeave(lineNum));
      lineElement.addEventListener('click', (e) => {
        if (e.target && e.target.classList?.contains('gcode-del')) return;
        this._onClick(lineNum, lineElement, e);
      });
      
      const txtEl = lineElement.querySelector('.gcode-line-text');
      if (txtEl) {
        txtEl.addEventListener('input', (e) => {
          sanitizeContentEditable(e.target);
          this._markLineAsChanged(lineNum);
          this._onLineEdited();
        });
        txtEl.addEventListener('focus', (e) => {
          // Capture original text when editing starts
          const originalText = e.target.textContent || '';
          this.editingOriginalText.set(lineNum, originalText);
          this._setCurrentlyEditing(lineNum);
        });
        txtEl.addEventListener('blur', (e) => {
          sanitizeContentEditable(e.target);
          
          // Check if text actually changed and create undo command
          const currentText = e.target.textContent || '';
          const originalText = this.editingOriginalText.get(lineNum);
          
          if (originalText !== undefined && originalText !== currentText) {
            this._debug('Text changed on line', lineNum, 'from:', originalText, 'to:', currentText);
            // Create and push edit command for undo/redo
            const editCommand = this._createEditCommand(lineNum, originalText, currentText);
            this.undoSystem.push(editCommand);
          }
          
          // Clean up tracking
          this.editingOriginalText.delete(lineNum);
          this._setCurrentlyEditing(null);
          this._onLineEdited(true);
        });
        txtEl.addEventListener('paste', (e) => {
          // Prevent pasting HTML content
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
          if (this.selectedLines.has(lineNum) && this.selectedLines.size > 1) {
            this._onBulkDelete();
          } else {
            this._onDelete(lineNum);
          }
        });
      }
    } catch (error) {
      console.error('Error binding events for line', lineNum, ':', error);
    }
  }

  _rebindLineEvents() {
    // Only rebind events for lines that need it - much more efficient
    try {
      this.bodyEl.querySelectorAll('.gcode-line').forEach(div => {
        const lineNum = parseInt(div.dataset.line);
        if (!isNaN(lineNum)) {
          // Remove old event listeners by replacing with clone (unavoidable for cleanup)
          const newDiv = div.cloneNode(true);
          div.parentNode.replaceChild(newDiv, div);
          
          // Re-bind events using centralized method
          this._bindLineEvents(newDiv, lineNum);
        }
      });
    } catch (error) {
      console.error('Error rebinding line events:', error);
      // Attempt recovery by refreshing content
      this._emitContentChanged(this.getText());
    }
  }

  _emitContentChanged(text) {
    // Sanitize the entire content before emitting
    const sanitized = sanitizeText(text);
    this.eventBus.emit('drawer:content:changed', { text: sanitized }, { skipValidation: true });
  }
}

export default GCodeDrawer;
