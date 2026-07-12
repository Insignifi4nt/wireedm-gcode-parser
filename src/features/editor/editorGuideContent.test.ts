import { describe, expect, it } from 'vitest';

import { getEditorGuideCopy } from './editorGuideContent';

describe('editor guide content', () => {
  it('documents the non-conflicting measurement clear shortcut in both languages', () => {
    const englishSteps = getEditorGuideCopy('en').sections.flatMap((section) =>
      section.steps.map((step) => step.text)
    );
    const romanianSteps = getEditorGuideCopy('ro').sections.flatMap((section) =>
      section.steps.map((step) => step.text)
    );

    expect(englishSteps).toContain(
      'Alt/Option+Shift+C clears all measurement points when focus is not inside an input or the program editor.'
    );
    expect(romanianSteps).toContain(
      'Alt/Option+Shift+C curata toate punctele de masurare cand focusul nu este intr-un input sau in editorul de program.'
    );
    expect(englishSteps.join(' ')).not.toContain('Ctrl/Cmd+C clears');
    expect(romanianSteps.join(' ')).not.toContain('Ctrl/Cmd+C curata');
  });
});
