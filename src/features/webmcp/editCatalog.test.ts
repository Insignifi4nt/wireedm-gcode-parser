import { describe, expect, it } from 'vitest';
import { editCatalogTool } from './editCatalog';
import { projectEdit } from './projectEdits';

describe('precise edit discovery', () => {
  it('lists every accepted edit kind and advertises units and undo/save behavior', async () => {
    const result = await editCatalogTool().execute({}) as { data: { edits: { kind: string }[] } };
    expect(result).toMatchObject({ ok: true, data: { units: 'mm', angleUnits: 'degrees', atomic: true, savedAutomatically: false } });
    expect(result.data.edits.map(edit => edit.kind)).toEqual(projectEdit.anyOf.map(schema => schema.properties.kind.const));
    expect(JSON.stringify(result).length).toBeLessThan(32 * 1024);
  });
  it('returns the exact accepted schema for a selected edit and rejects unknown edit kinds', async () => {
    expect(await editCatalogTool().execute({ kind: 'entry' })).toMatchObject({ ok: true, data: { edits: [{ kind: 'entry',
      description: expect.stringContaining('null explicitly reviews'), schema: projectEdit.anyOf.find(schema => schema.properties.kind.const === 'entry') }] } });
    expect(await editCatalogTool().execute({ kind: 'arbitrary-replacement' })).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
  });
});
