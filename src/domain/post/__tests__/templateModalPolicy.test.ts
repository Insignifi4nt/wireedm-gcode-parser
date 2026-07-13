import { describe, expect, it } from 'vitest';

import {
  createBlankMachineProfile,
  createVerifiedCharmillesRobofil100Profile
} from '@/domain/machine/machineProfiles';

import { validateTemplateModalPolicy } from '../templateModalPolicy';

describe('validateTemplateModalPolicy', () => {
  it.each(['G21', 'G17', 'G54', 'G40', 'M30', 'G41 D0', 'G42D0'])(
    'rejects the real conflicting Robofil word in %s',
    (word) => {
      const machine = createVerifiedCharmillesRobofil100Profile();

      const result = validateTemplateModalPolicy({
        machine,
        header: word,
        footer: ''
      });

      expect(result.valid).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ section: 'header', word: expect.stringMatching(/^[GM]\d+$/) })
      );
    }
  );

  it('ignores comments and larger unrelated words', () => {
    const machine = createVerifiedCharmillesRobofil100Profile();

    const result = validateTemplateModalPolicy({
      machine,
      header: '(G21 G17 G54 G40 M30 G41 G42) G210 G170 G540 G400 M300 G410 G420',
      footer: '; G21 G41 M30\nN42'
    });

    expect(result).toEqual({ valid: true, diagnostics: [] });
  });

  it.each(['G90G21', 'N10G17', 'G90M30'])(
    'recognizes compact or line-number-prefixed conflicting words in %s',
    (header) => {
      const result = validateTemplateModalPolicy({
        machine: createVerifiedCharmillesRobofil100Profile(),
        header,
        footer: ''
      });

      expect(result.valid).toBe(false);
    }
  );

  it.each(['G20', 'G39', 'G92', 'G38', 'G60', 'G90', 'G1 X1', 'M02'])(
    'rejects the unverified Robofil template lifecycle word in %s',
    (word) => {
      const result = validateTemplateModalPolicy({
        machine: createVerifiedCharmillesRobofil100Profile(),
        header: '',
        footer: word
      });

      expect(result.valid).toBe(false);
      expect(result.diagnostics[0]).toMatchObject({ section: 'footer' });
    }
  );

  it('ignores conflicting words inside nested parenthetical comments', () => {
    const result = validateTemplateModalPolicy({
      machine: createVerifiedCharmillesRobofil100Profile(),
      header: '(outer (G20 G39 G92 G60 M02) comment)',
      footer: ''
    });

    expect(result).toEqual({ valid: true, diagnostics: [] });
  });

  it('does not impose the Robofil forbidden-word policy on a custom profile', () => {
    const machine = createBlankMachineProfile();

    const result = validateTemplateModalPolicy({
      machine,
      header: 'G21 G17 G54 G40 G41 D0',
      footer: 'G42 D0 M30'
    });

    expect(result).toEqual({ valid: true, diagnostics: [] });
  });
});
