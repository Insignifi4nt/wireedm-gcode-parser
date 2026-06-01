import { describe, expect, it } from 'vitest';

import { dxfEntitiesToUpidDocument } from '@/domain/dxf/dxfToUpid';
import { parseDxf } from '@/domain/dxf/parseDxf';
import type { LoadedEditorProgram } from '@/domain/editor/loadEditorProgram';

import {
  createEditorDraftState,
  editorDraftPathDocument,
  editorDraftSignature,
  editorDraftText
} from './editorDraftState';

describe('editorDraftState', () => {
  it('creates UPID drafts from path documents instead of loaded program text', () => {
    const pathDocument = pathDocumentFromRectangle();
    const program = {
      filePath: 'projects/rectangle/project.json',
      model: 'upid-document',
      parseResult: null,
      pathDocument,
      project: undefined,
      text: 'G0 X999 Y999'
    } as unknown as LoadedEditorProgram;

    const draft = createEditorDraftState(program);

    expect(draft.model).toBe('upid-document');
    expect('text' in draft).toBe(false);
    expect(editorDraftText(draft)).toBe('');
    expect(editorDraftPathDocument(draft)).toEqual(pathDocument);
    expect(editorDraftPathDocument(draft)).not.toBe(pathDocument);
  });

  it('keeps empty posted text and empty UPID path drafts distinct', () => {
    const pathDocument = pathDocumentFromRectangle();

    expect(editorDraftSignature({ model: 'gcode-text', text: '' })).not.toBe(
      editorDraftSignature({ model: 'upid-document', pathDocument })
    );
  });
});

function pathDocumentFromRectangle() {
  return dxfEntitiesToUpidDocument(parseDxf(rectangleDxf()).entities);
}

function rectangleDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'LWPOLYLINE',
    '90',
    '4',
    '70',
    '1',
    '10',
    '0',
    '20',
    '0',
    '10',
    '10',
    '20',
    '0',
    '10',
    '10',
    '20',
    '5',
    '10',
    '0',
    '20',
    '5',
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}
