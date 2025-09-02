/**
 * GCodeDrawer Component
 * Collapsible panel that shows raw G-code, supports hover/click highlight,
 * and inserts measurement points at a chosen line.
 */

import { EventBus, EVENT_TYPES } from '../core/EventManager.js';

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
    this.selectedLines = new Set(); // Set of selected line numbers
    this.lastClickedLine = null; // For shift-click range selection
    this._debounceTimer = null;
    this.linesWithChanges = new Set(); // Track lines with unsaved changes
    this.currentlyEditingLine = null; // Track currently focused line
    this.editingOriginalText = new Map(); // Track original text when editing starts
    this.undoStack = []; // Command history for undo
    this.redoStack = []; // Command history for redo
    this.maxHistorySize = 50; // Limit history size
    mountTarget.appendChild(this.container);
    this._render();
    this._bindGlobalEvents();
  }

  _render() {
    this.container.innerHTML = `
      <div class="gcode-drawer-header">
        <div class="gcode-drawer-title">
          <strong>G-Code</strong>
          <span class="gcode-line-count">0 lines</span>
        </div>
        <div class="gcode-drawer-actions">
          <button class="gcode-action-btn" data-action="undo" title="Undo (Ctrl+Z)" disabled>↶</button>
          <button class="gcode-action-btn" data-action="redo" title="Redo (Ctrl+Y)" disabled>↷</button>
          <button class="gcode-action-btn" data-action="close" title="Close drawer">×</button>
        </div>
      </div>
      <div class="gcode-context-toolbar" style="display: none;">
        <div class="gcode-selection-info">
          <span class="gcode-selection-counter"></span>
        </div>
        <div class="gcode-selection-actions">
          <button class="gcode-toolbar-btn" data-action="move-up" title="Move selected lines up" disabled>↑</button>
          <button class="gcode-toolbar-btn" data-action="move-down" title="Move selected lines down" disabled>↓</button>
          <button class="gcode-toolbar-btn" data-action="insert-points" title="Insert clicked points">+ Points</button>
          <button class="gcode-toolbar-btn" data-action="delete-selected" title="Delete selected lines">🗑</button>
        </div>
      </div>
      <div class="gcode-drawer-body" tabindex="0"></div>
      <div class="gcode-drawer-footer">
        <div class="gcode-help-text">Hover to preview • Click to select • Ctrl+click for multi-select</div>
      </div>
    `;
    this.headerEl = this.container.querySelector('.gcode-drawer-header');
    this.bodyEl = this.container.querySelector('.gcode-drawer-body');
    this.footerEl = this.container.querySelector('.gcode-drawer-footer');
    
    // Add keyboard event handling
    this.bodyEl.addEventListener('keydown', (e) => this._onKeyDown(e));

    // Header events
    this.container.querySelector('[data-action="close"]').addEventListener('click', () => this.toggle(false));
    this.container.querySelector('[data-action="undo"]').addEventListener('click', () => this._undo());
    this.container.querySelector('[data-action="redo"]').addEventListener('click', () => this._redo());
    
    // Context toolbar events
    this.container.querySelector('[data-action="move-up"]').addEventListener('click', () => this._moveSelectedLines(-1));
    this.container.querySelector('[data-action="move-down"]').addEventListener('click', () => this._moveSelectedLines(1));
    this.container.querySelector('[data-action="insert-points"]').addEventListener('click', async () => {
      try {
        const firstSelected = this.selectedLines.size > 0 ? Math.min(...this.selectedLines) : null;
        const atIndex = firstSelected != null ? (this.lineIndexToPathIndex.get(firstSelected) ?? null) : null;
        const points = await this._getClickedPointsFromApp();
        this.eventBus.emit('drawer:insert:points', { atIndex, points }, { skipValidation: true });
      } catch (error) {
        console.error('Error inserting points:', error);
      }
    });
    this.container.querySelector('[data-action="delete-selected"]').addEventListener('click', () => this._onBulkDelete());
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
    this.selectedLines.clear();
    this.lastClickedLine = null;
    this.linesWithChanges.clear();
    this.currentlyEditingLine = null;
    this.editingOriginalText.clear();
    
    // Only clear undo/redo history if preserveHistory is false
    if (!preserveHistory) {
      console.log('GCodeDrawer: Clearing undo/redo history');
      this.undoStack = [];
      this.redoStack = [];
    } else {
      console.log('GCodeDrawer: Preserving undo/redo history, stack sizes:', this.undoStack.length, this.redoStack.length);
    }
    const rawLines = (text || '').split(/\r?\n/);
    rawLines.forEach((t, i) => {
      const lineNum = i + 1;
      const div = this._createLineElement(lineNum, t);
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
    this.selectedLines.clear();
    this.selectedLines.add(lineNum);
  }

  _toggleSelection(lineNum, element) {
    if (this.selectedLines.has(lineNum)) {
      this.selectedLines.delete(lineNum);
    } else {
      this.selectedLines.add(lineNum);
    }
  }

  _selectRange(startLine, endLine) {
    this.selectedLines.clear();
    for (let i = startLine; i <= endLine; i++) {
      this.selectedLines.add(i);
    }
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
    
    // Show/hide context toolbar based on selection
    const contextToolbar = this.container.querySelector('.gcode-context-toolbar');
    if (contextToolbar) {
      contextToolbar.style.display = hasSelection ? 'flex' : 'none';
    }
    
    // Update selection counter
    const selectionCounter = this.container.querySelector('.gcode-selection-counter');
    if (selectionCounter && hasSelection) {
      selectionCounter.textContent = `${count} line${count !== 1 ? 's' : ''} selected`;
    }
    
    // Enable/disable toolbar controls based on selection  
    const moveUpBtn = this.container.querySelector('[data-action="move-up"]');
    const moveDownBtn = this.container.querySelector('[data-action="move-down"]');
    const deleteBtn = this.container.querySelector('[data-action="delete-selected"]');
    const insertBtn = this.container.querySelector('[data-action="insert-points"]');
    
    if (moveUpBtn) moveUpBtn.disabled = !hasSelection;
    if (moveDownBtn) moveDownBtn.disabled = !hasSelection;
    if (deleteBtn) deleteBtn.disabled = !hasSelection;
    if (insertBtn) insertBtn.disabled = !hasSelection;
  }
  
  _restoreSelection(lineNumbers) {
    // Helper method to restore selection to specific line numbers
    console.log('GCodeDrawer: Restoring selection to lines:', lineNumbers);
    this.selectedLines.clear();
    lineNumbers.forEach(lineNum => {
      // Only add valid line numbers that exist in the current DOM
      const lineEl = this.bodyEl.querySelector(`.gcode-line[data-line="${lineNum}"]`);
      if (lineEl) {
        this.selectedLines.add(lineNum);
      }
    });
    this._updateSelectionVisuals();
  }
  
  _updateLineCount() {
    const lineCountEl = this.container.querySelector('.gcode-line-count');
    if (lineCountEl) {
      const count = this.lines.length;
      lineCountEl.textContent = `${count} line${count !== 1 ? 's' : ''}`;
    }
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
  _pushCommand(command) {
    console.log('GCodeDrawer: Pushing command to undo stack:', command.type, 'Stack size before:', this.undoStack.length);
    
    // Add command to undo stack
    this.undoStack.push(command);
    
    // Clear redo stack when new command is added
    this.redoStack = [];
    
    // Limit history size
    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift();
    }
    
    console.log('GCodeDrawer: Command pushed, new stack size:', this.undoStack.length);
    this._updateUndoRedoButtons();
  }
  
  _undo() {
    if (this.undoStack.length === 0) return;
    
    const command = this.undoStack.pop();
    console.log('GCodeDrawer: Executing undo for command:', command.type);
    command.undo();
    this.redoStack.push(command);
    
    this._updateUndoRedoButtons();
    
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
    if (this.redoStack.length === 0) return;
    
    const command = this.redoStack.pop();
    console.log('GCodeDrawer: Executing redo for command:', command.type);
    command.execute();
    this.undoStack.push(command);
    
    this._updateUndoRedoButtons();
    
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
    const undoBtn = this.container.querySelector('[data-action="undo"]');
    const redoBtn = this.container.querySelector('[data-action="redo"]');
    
    console.log('GCodeDrawer: Updating undo/redo buttons. Undo stack:', this.undoStack.length, 'Redo stack:', this.redoStack.length);
    
    if (undoBtn) {
      const wasDisabled = undoBtn.disabled;
      undoBtn.disabled = this.undoStack.length === 0;
      if (wasDisabled !== undoBtn.disabled) {
        console.log('GCodeDrawer: Undo button', undoBtn.disabled ? 'disabled' : 'enabled');
      }
      undoBtn.title = this.undoStack.length > 0 
        ? `Undo (Ctrl+Z) - ${this.undoStack.length} action${this.undoStack.length !== 1 ? 's' : ''}` 
        : 'Undo (Ctrl+Z)';
    }
    
    if (redoBtn) {
      const wasDisabled = redoBtn.disabled;
      redoBtn.disabled = this.redoStack.length === 0;
      if (wasDisabled !== redoBtn.disabled) {
        console.log('GCodeDrawer: Redo button', redoBtn.disabled ? 'disabled' : 'enabled');
      }
      redoBtn.title = this.redoStack.length > 0 
        ? `Redo (Ctrl+Y) - ${this.redoStack.length} action${this.redoStack.length !== 1 ? 's' : ''}` 
        : 'Redo (Ctrl+Y)';
    }
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
        this.selectedLines.clear();
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
  
  _createMoveCommand(fromIndices, direction) {
    // Store original line positions
    const originalLines = [...fromIndices];
    
    return {
      type: 'move',
      fromIndices: originalLines,
      direction: direction,
      execute: () => {
        // For redo operations, restore selection and move
        console.log('GCodeDrawer: Move command execute, restoring selection to lines:', originalLines.map(n => n + direction));
        this._restoreSelection(originalLines.map(lineNum => lineNum + direction));
        this._moveSelectedLinesInternal(direction);
      },
      undo: () => {
        // For undo operations, restore selection to moved positions and move back
        console.log('GCodeDrawer: Move command undo, restoring selection to lines:', originalLines.map(n => n + direction));
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
    // If the line is not mapped to a path index, append at current selected line position in text
    const gcodeText = this.getText();
    const firstSelected = this.selectedLines.size > 0 ? Math.min(...this.selectedLines) : null;
    const insertAfterLine = firstSelected || 1;
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
      // Reduced debounce timeout from 300ms to 100ms for better responsiveness
      this._debounceTimer = setTimeout(fire, 100);
    }
  }

  _onDelete(lineNum) {
    const lineEl = this.bodyEl.querySelector(`.gcode-line[data-line="${lineNum}"]`);
    if (!lineEl) return;
    
    // Capture state for undo
    const allLines = Array.from(this.bodyEl.querySelectorAll('.gcode-line'));
    const linesData = [{
      lineNum: lineNum,
      text: lineEl.querySelector('.gcode-line-text').textContent,
      originalIndex: allLines.indexOf(lineEl)
    }];
    
    // Create and push delete command
    const deleteCommand = this._createDeleteCommand([lineNum], linesData);
    this._pushCommand(deleteCommand);
    
    // Execute delete
    deleteCommand.execute();
    
    // Update internal lines array
    this.lines = this.lines.filter(line => line.num !== lineNum);
    
    // Remove from selection if it was selected
    this.selectedLines.delete(lineNum);
    if (this.lastClickedLine === lineNum) {
      this.lastClickedLine = null;
    }
    
    this._emitContentChanged(this.getText());
  }

  _onKeyDown(e) {
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
  }

  _onBulkDelete() {
    if (this.selectedLines.size === 0) return;
    
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
    const deleteCommand = this._createDeleteCommand(sortedLines, linesData);
    this._pushCommand(deleteCommand);
    
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
    
    const sortedSelection = Array.from(this.selectedLines).sort((a, b) => a - b);
    
    // Create and push move command
    const moveCommand = this._createMoveCommand(sortedSelection, direction);
    this._pushCommand(moveCommand);
    
    // Execute initial move (selection is already correct)
    this._moveSelectedLinesInternal(direction);
    
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
      this.selectedLines.clear();
      sortedSelection.forEach(lineNum => {
        this.selectedLines.add(lineNum + direction);
      });
      
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
          this._sanitizeContentEditableInput(e.target);
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
          this._sanitizeContentEditableInput(e.target);
          
          // Check if text actually changed and create undo command
          const currentText = e.target.textContent || '';
          const originalText = this.editingOriginalText.get(lineNum);
          
          if (originalText !== undefined && originalText !== currentText) {
            console.log('GCodeDrawer: Text changed on line', lineNum, 'from:', originalText, 'to:', currentText);
            // Create and push edit command for undo/redo
            const editCommand = this._createEditCommand(lineNum, originalText, currentText);
            this._pushCommand(editCommand);
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
          const sanitized = this._sanitizeInput(paste);
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

  _sanitizeInput(input) {
    // Remove HTML tags and decode entities for security
    if (!input || typeof input !== 'string') return '';
    
    // Create a temporary div to decode HTML entities and strip tags
    const tempDiv = document.createElement('div');
    tempDiv.textContent = input; // This automatically escapes HTML
    let sanitized = tempDiv.innerHTML; // Get the escaped version
    
    // Decode common HTML entities back to plain text
    const entityMap = {
      '&lt;': '<',
      '&gt;': '>',
      '&amp;': '&',
      '&quot;': '"',
      '&#x27;': "'",
      '&#x2F;': '/'
    };
    
    sanitized = sanitized.replace(/&(lt|gt|amp|quot|#x27|#x2F);/g, (match, entity) => {
      return entityMap[`&${entity};`] || match;
    });
    
    // Remove any remaining HTML-like content and control characters
    sanitized = sanitized
      .replace(/<[^>]*>/g, '') // Remove any HTML tags
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control chars except tab, newline
      .trim();
    
    return sanitized;
  }

  _sanitizeContentEditableInput(element) {
    if (!element) return;
    
    const originalText = element.textContent || '';
    const sanitized = this._sanitizeInput(originalText);
    
    // Only update if content changed to avoid cursor jumping
    if (originalText !== sanitized) {
      const selection = window.getSelection();
      const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      const cursorOffset = range ? range.startOffset : 0;
      
      element.textContent = sanitized;
      
      // Restore cursor position if possible
      try {
        if (range && sanitized.length >= cursorOffset) {
          range.setStart(element.childNodes[0] || element, Math.min(cursorOffset, sanitized.length));
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      } catch (e) {
        // Cursor restoration failed, not critical
      }
    }
  }

  _emitContentChanged(text) {
    // Sanitize the entire content before emitting
    const sanitized = this._sanitizeInput(text);
    this.eventBus.emit('drawer:content:changed', { text: sanitized }, { skipValidation: true });
    
    // Clear change indicators after emitting changes
    this._clearChangeIndicators();
  }
}

export default GCodeDrawer;


