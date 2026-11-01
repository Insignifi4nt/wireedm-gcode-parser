import { describe, expect, it } from 'vitest';
import { checkFeatureActivity, featureActivityReadsIn } from '../../../../scripts/check-feature-activity';

const scan = (text: string) => featureActivityReadsIn('fixture.ts', text);

describe('feature activity scanner', () => {
  it('finds each spelling of a read of the stored suppression flag, on its line', () => {
    const source = [
      'const a = feature.suppressed;',
      'const b = feature?.suppressed;',
      "const c = feature['suppressed'];",
      'const d = feature[`suppressed`];',
      'const { suppressed } = feature;',
      'const { suppressed: off } = feature;',
      'const pick = ({ suppressed }: CadFeature) => suppressed;',
      "const { 'suppressed': quoted } = feature;",
      'for (const { suppressed: each } of features) void each;'
    ].join('\n');
    expect(scan(source)).toEqual([
      { spelling: '.suppressed', line: 1 },
      { spelling: '.suppressed', line: 2 },
      { spelling: "['suppressed']", line: 3 },
      { spelling: "['suppressed']", line: 4 },
      { spelling: '{ suppressed }', line: 5 },
      { spelling: '{ suppressed }', line: 6 },
      { spelling: '{ suppressed }', line: 7 },
      { spelling: '{ suppressed }', line: 8 },
      { spelling: '{ suppressed }', line: 9 }
    ]);
  });

  it('ignores writes of the flag, other names, comments and text', () => {
    const source = [
      '// feature.suppressed is read through cadFeatureActive',
      "const message = 'feature.suppressed';",
      'const next = { ...feature, suppressed: true };',
      'const suppressed = true; const kept = { suppressed };',
      'const off = cursor.snapSuppressed || state.suppressedCount;',
      "type Flag = CadFeature['suppressed'];",
      'const [suppressedFirst] = list;'
    ].join('\n');
    expect(scan(source)).toEqual([]);
  });

  it('passes on the repository, where only the activity module reads the flag', async () => {
    const result = await checkFeatureActivity();
    expect(result.problems).toEqual([]);
    expect(result.checked).toBeGreaterThan(500);
  });
});
