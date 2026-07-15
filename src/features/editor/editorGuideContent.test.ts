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
      'While Measurement & Construction is open, Alt/Option+Shift+C clears all points when focus is not inside an input.'
    );
    expect(romanianSteps).toContain(
      'Cat timp Measurement & Construction este deschis, Alt/Option+Shift+C curata toate punctele cand focusul nu este intr-un input.'
    );
    expect(englishSteps.join(' ')).not.toContain('Ctrl/Cmd+C clears');
    expect(romanianSteps.join(' ')).not.toContain('Ctrl/Cmd+C curata');
  });
});
