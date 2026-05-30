/**
 * UndoRedoSystem
 * Centralized command history with size limits and state change notifications.
 */

export class UndoRedoSystem {
  constructor(options = {}) {
    this.undoStack = [];
    this.redoStack = [];
    this.maxHistorySize = typeof options.max === 'number' ? options.max : 50;
    this._onChange = typeof options.onChange === 'function' ? options.onChange : null;
  }

  setMax(size) {
    if (typeof size === 'number' && size > 0) {
      this.maxHistorySize = size;
      // Trim if needed
      while (this.undoStack.length > this.maxHistorySize) {
        this.undoStack.shift();
      }
      this._notify();
    }
  }

  onChange(callback) {
    this._onChange = typeof callback === 'function' ? callback : null;
  }

  push(command) {
    this.undoStack.push(command);
    // Clearing redo stack on new command
    this.redoStack = [];

    // Enforce history size
    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift();
    }

    this._notify();
  }

  undo() {
    if (this.undoStack.length === 0) return null;
    const command = this.undoStack.pop();
    command.undo();
    this.redoStack.push(command);
    this._notify();
    return command;
  }

  redo() {
    if (this.redoStack.length === 0) return null;
    const command = this.redoStack.pop();
    command.execute();
    this.undoStack.push(command);
    this._notify();
    return command;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this._notify();
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  getUndoCount() {
    return this.undoStack.length;
  }

  getRedoCount() {
    return this.redoStack.length;
  }

  _notify() {
    if (this._onChange) {
      try { this._onChange({
        canUndo: this.canUndo(),
        canRedo: this.canRedo(),
        undoCount: this.getUndoCount(),
        redoCount: this.getRedoCount()
      }); } catch (_e) { /* ignore */ }
    }
  }
}

export default UndoRedoSystem;

