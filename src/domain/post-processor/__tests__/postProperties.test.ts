import { describe, expect, it } from 'vitest';

import { parseWireEdmPostPackage } from '../postPackage';
import { validatePostPropertyValues } from '../postProperties';
import { minimalPostPackage } from './postPackageFixture';

function packageFixture() {
  const input = minimalPostPackage();
  Object.assign(input.manifest.properties, {
    comments: {
      type: 'boolean',
      description: 'Emit operator comments.',
      required: false,
      suggestedValue: true
    },
    endCode: {
      type: 'choice',
      description: 'Controller program end command.',
      required: true,
      choices: ['M02', 'M30'],
      suggestedValue: 'M02'
    }
  });
  Object.assign(input.fixtures[0].properties, { endCode: 'M02' });
  const result = parseWireEdmPostPackage(JSON.stringify(input));
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.package;
}

describe('post binding property values', () => {
  it('accepts explicit values without materializing suggested values', () => {
    expect(validatePostPropertyValues(packageFixture(), {
      coordinatePrecision: 4,
      endCode: 'M02'
    })).toEqual({
      ok: true,
      values: { coordinatePrecision: 4, endCode: 'M02' }
    });
  });

  it('reports missing, unknown, and invalid values together with exact paths', () => {
    expect(validatePostPropertyValues(packageFixture(), {
      coordinatePrecision: 9,
      comments: 'yes',
      obsoleteSetting: true
    })).toEqual({
      ok: false,
      diagnostics: [
        {
          code: 'POST_PROPERTY_VALUE_INVALID',
          path: '/coordinatePrecision',
          message: 'Property coordinatePrecision must be an integer between 0 and 6.'
        },
        {
          code: 'POST_PROPERTY_VALUE_INVALID',
          path: '/comments',
          message: 'Property comments must be a boolean.'
        },
        {
          code: 'POST_PROPERTY_UNKNOWN',
          path: '/obsoleteSetting',
          message: 'Property obsoleteSetting is not declared by example.robofil-classic@1.0.0.'
        },
        {
          code: 'POST_PROPERTY_REQUIRED',
          path: '/endCode',
          message: 'Required property endCode is missing.'
        }
      ]
    });
  });

  it('does not accept inherited object names as declared properties', () => {
    expect(validatePostPropertyValues(packageFixture(), {
      coordinatePrecision: 3,
      endCode: 'M02',
      toString: true,
      constructor: 123
    })).toEqual({
      ok: false,
      diagnostics: [
        {
          code: 'POST_PROPERTY_UNKNOWN',
          path: '/toString',
          message: 'Property toString is not declared by example.robofil-classic@1.0.0.'
        },
        {
          code: 'POST_PROPERTY_UNKNOWN',
          path: '/constructor',
          message: 'Property constructor is not declared by example.robofil-classic@1.0.0.'
        }
      ]
    });
  });
});
