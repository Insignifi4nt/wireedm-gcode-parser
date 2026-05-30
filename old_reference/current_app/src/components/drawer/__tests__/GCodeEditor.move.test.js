import { describe, it, expect } from 'vitest';
import { GCodeEditor } from '../GCodeEditor.js';
import { UndoRedoSystem } from '../UndoRedoSystem.js';

const selectionArray = (sel) => Array.from(sel).sort((a, b) => a - b);
const lineTexts = (bodyEl) =>
  Array.from(bodyEl.querySelectorAll('.gcode-line-text')).map((el) => el.textContent);

const setupEditor = (lines) => {
  const bodyEl = document.createElement('div');
  let selection = new Set();
  const applySelection = (sel) => {
    if (sel instanceof Set) selection = new Set(sel);
    else selection = new Set(sel || []);
  };
  const undoSystem = new UndoRedoSystem();
  const editor = new GCodeEditor(bodyEl, {
    undoSystem,
    editMode: false,
    onLineEdited: () => {},
    onHover: () => {},
    onLeave: () => {},
    onClick: () => {},
    onDeleteLine: () => {},
    onBulkDelete: () => {},
    getSelection: () => selection,
    applySelection,
    updateLineCount: () => {}
  });
  editor.setLines(lines);
  return {
    editor,
    undoSystem,
    bodyEl,
    setSelection: (sel) => applySelection(sel),
    getSelection: () => selection
  };
};

describe('GCodeEditor move command', () => {
  it('moves a block down and restores correctly on undo/redo', () => {
    const { editor, undoSystem, bodyEl, setSelection, getSelection } = setupEditor([
      'A',
      'B',
      'C',
      'D',
      'E'
    ]);

    setSelection([2, 3]); // move B and C down by one line
    const moveCmd = editor.createMoveCommand(selectionArray(getSelection()), 1);
    undoSystem.push(moveCmd);

    editor._moveSelectedLinesInternal(1);
    expect(lineTexts(bodyEl)).toEqual(['A', 'D', 'B', 'C', 'E']);
    expect(selectionArray(getSelection())).toEqual([3, 4]);

    undoSystem.undo();
    expect(lineTexts(bodyEl)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(selectionArray(getSelection())).toEqual([2, 3]);

    undoSystem.redo();
    expect(lineTexts(bodyEl)).toEqual(['A', 'D', 'B', 'C', 'E']);
    expect(selectionArray(getSelection())).toEqual([3, 4]);
  });

  it('moves a block up and restores correctly on undo/redo', () => {
    const { editor, undoSystem, bodyEl, setSelection, getSelection } = setupEditor([
      'A',
      'B',
      'C',
      'D',
      'E'
    ]);

    setSelection([3, 4]); // move C and D up by one line
    const moveCmd = editor.createMoveCommand(selectionArray(getSelection()), -1);
    undoSystem.push(moveCmd);

    editor._moveSelectedLinesInternal(-1);
    expect(lineTexts(bodyEl)).toEqual(['A', 'C', 'D', 'B', 'E']);
    expect(selectionArray(getSelection())).toEqual([2, 3]);

    undoSystem.undo();
    expect(lineTexts(bodyEl)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(selectionArray(getSelection())).toEqual([3, 4]);

    undoSystem.redo();
    expect(lineTexts(bodyEl)).toEqual(['A', 'C', 'D', 'B', 'E']);
    expect(selectionArray(getSelection())).toEqual([2, 3]);
  });
});
