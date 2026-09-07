import { describe, expect, it } from 'vitest';

import { getEditorGuideCopy } from './editorGuideContent';

describe('editor guide content', () => {
  it.each(['en', 'ro'] as const)('offers only path-project actions in the %s path guide', language => {
    const pathSteps = getEditorGuideCopy(language, 'path').sections.flatMap(section => section.steps);
    expect(pathSteps.some(step => step.text.includes('Minimum feature gap'))).toBe(true);
    expect(pathSteps.some(step => step.highlightTarget === 'grid-snap')).toBe(true);
    expect(pathSteps.map(step => step.highlightTarget).filter(Boolean)).toEqual(['preview', 'grid-snap', 'measurement-points']);
    const programSteps = getEditorGuideCopy(language, 'program').sections.flatMap(section => section.steps);
    expect(programSteps.some(step => step.highlightTarget === 'normalize-draft')).toBe(true);
    expect(programSteps.some(step => step.text.includes('Minimum feature gap'))).toBe(false);
  });

  it('documents the non-conflicting measurement clear shortcut in both languages', () => {
    const englishSteps = getEditorGuideCopy('en').sections.flatMap((section) =>
      section.steps.map((step) => step.text)
    );
    const romanianSteps = getEditorGuideCopy('ro').sections.flatMap((section) =>
      section.steps.map((step) => step.text)
    );

    expect(englishSteps).toContain(
      'While Construction points is open, Alt/Option+Shift+C clears all points when focus is not inside an input.'
    );
    expect(romanianSteps).toContain(
      'Cat timp Construction points este deschis, Alt/Option+Shift+C curata toate punctele cand focusul nu este intr-un input.'
    );
    expect(englishSteps.join(' ')).not.toContain('Ctrl/Cmd+C clears');
    expect(romanianSteps.join(' ')).not.toContain('Ctrl/Cmd+C curata');
  });
});
