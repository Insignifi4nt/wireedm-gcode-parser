import { describe, it, expect } from 'vitest';
import { getGuideCopy } from '../utils/UserGuideContent.js';

describe('UserGuideContent', () => {
  it('provides comprehensive English and Romanian manual sections', () => {
    const en = getGuideCopy('en');
    const ro = getGuideCopy('ro');

    expect(en.sections.length).toBeGreaterThanOrEqual(8);
    expect(ro.sections).toHaveLength(en.sections.length);
    expect(en.sections.flatMap(section => section.steps).length).toBeGreaterThan(20);
  });

  it('includes highlight targets for the most important controls', () => {
    const targets = getGuideCopy('en').sections
      .flatMap(section => section.steps)
      .map(step => step.highlight?.selector)
      .filter(Boolean);

    expect(targets).toEqual(expect.arrayContaining([
      '[data-toolbar="file-input-label"]',
      '[data-toolbar="toggle-gcode-drawer"]',
      '.gcode-line-pin',
      '[data-action="clear-pins"]',
      '[data-toolbar="normalize-to-iso"]'
    ]));
  });
});
