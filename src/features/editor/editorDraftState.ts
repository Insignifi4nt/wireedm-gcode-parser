import type { LoadedEditorProgram } from '@/domain/editor/loadEditorProgram';
import type { EditorSaveDraft } from '@/domain/editor/saveEditorProgram';
import type { PathPlanningDocument } from '@/domain/path-intel/types';

export type EditorDraftState = EditorSaveDraft;

export function createEditorDraftState(program: LoadedEditorProgram | null): EditorDraftState {
  if (program?.model === 'upid-document') {
    return {
      model: 'upid-document',
      pathDocument: clonePathDocument(program.pathDocument)
    };
  }

  return {
    model: 'gcode-text',
    text: program?.text ?? ''
  };
}

export function cloneEditorDraftState(draft: EditorDraftState): EditorDraftState {
  if (draft.model === 'upid-document') {
    return {
      model: 'upid-document',
      pathDocument: clonePathDocument(draft.pathDocument)
    };
  }

  return {
    model: 'gcode-text',
    text: draft.text
  };
}

export function editorDraftPathDocument(draft: EditorDraftState): PathPlanningDocument | null {
  return draft.model === 'upid-document' ? draft.pathDocument : null;
}

export function editorDraftSignature(draft: EditorDraftState) {
  return JSON.stringify(draft);
}

export function editorDraftText(draft: EditorDraftState) {
  return draft.model === 'gcode-text' ? draft.text : '';
}

function clonePathDocument(document: PathPlanningDocument) {
  return structuredClone(document);
}
