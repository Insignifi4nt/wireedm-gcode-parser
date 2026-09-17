import { describe, expect, it } from 'vitest';

import { parseWireEdmPostPackage } from '../postPackage';
import { minimalPostPackage } from './postPackageFixture';

describe('wire EDM post package boundary', () => {
  it('preserves optional app provenance and rejects malformed versions or unsafe links', () => {
    const input = minimalPostPackage();
    Object.assign(input.manifest, { authoredFor: {
      appVersion: '0.0.686', documentationUrl: 'https://example.org/docs/releases/0.0.686/'
    } });
    expect(parseWireEdmPostPackage(JSON.stringify(input))).toEqual({ ok: true, package: input });
    Object.assign(input.manifest, { authoredFor: { appVersion: 'latest', documentationUrl: 'javascript:alert(1)' } });
    expect(parseWireEdmPostPackage(JSON.stringify(input))).toMatchObject({ ok: false });
  });
  it('versions precise separation capabilities while reading legacy boolean snapshots', () => {
    const legacy = minimalPostPackage();
    expect(parseWireEdmPostPackage(JSON.stringify(legacy))).toMatchObject({ ok: true });
    const precise = structuredClone(legacy);
    Object.assign(precise, { schemaVersion: 2 });
    precise.manifest.capabilities.wireSeparation = ['automatic-during-positioning'];
    expect(parseWireEdmPostPackage(JSON.stringify(precise))).toMatchObject({ ok: true });
    Object.assign(precise, { schemaVersion: 1 });
    expect(parseWireEdmPostPackage(JSON.stringify(precise))).toMatchObject({ ok: false });
  });
  it('accepts exact controller-file rules owned by the post', () => {
    const input = minimalPostPackage();
    Object.assign(input.manifest, {
      output: {
        fileExtension: 'iso',
        lineEnding: 'crlf',
        encoding: 'ascii',
        finalNewline: true,
        blockNumbering: {
          mode: 'sequential',
          prefix: 'N',
          start: 10,
          increment: 10,
          minimumWidth: 1
        },
        programEnvelope: { prefix: ['%'], suffix: [] }
      }
    });

    expect(parseWireEdmPostPackage(JSON.stringify(input))).toMatchObject({ ok: true });
  });

  it('accepts package-owned dialect state tokens without teaching them to the application', () => {
    const input = minimalPostPackage();
    input.dialect.commands['distance.absolute'].effects = ['robofil.g60-issued'];
    input.dialect.commands['motion.linear'].requires = ['robofil.g60-issued'];

    expect(parseWireEdmPostPackage(JSON.stringify(input))).toMatchObject({ ok: true });
  });

  it('parses one complete package without changing its declared values', () => {
    const input = minimalPostPackage();
    const result = parseWireEdmPostPackage(JSON.stringify(input));

    expect(result).toEqual({ ok: true, package: input });
  });

  it.each([
    {
      label: 'obsolete schema',
      mutate: (input: ReturnType<typeof minimalPostPackage>) => {
        Object.assign(input, { schemaVersion: 0 });
      },
      code: 'POST_PACKAGE_SCHEMA_INVALID',
      path: '/schemaVersion'
    },
    {
      label: 'unknown package field',
      mutate: (input: ReturnType<typeof minimalPostPackage>) => {
        Object.assign(input.manifest, { legacyControllerFamily: 'generic-iso' });
      },
      code: 'POST_PACKAGE_SCHEMA_INVALID',
      path: '/manifest/legacyControllerFamily'
    },
    {
      label: 'SemVer prerelease with a leading zero',
      mutate: (input: ReturnType<typeof minimalPostPackage>) => {
        input.manifest.version = '1.0.0-01';
      },
      code: 'POST_PACKAGE_SCHEMA_INVALID',
      path: '/manifest/version'
    }
  ])('rejects $label instead of coercing or defaulting it', ({ mutate, code, path }) => {
    const input = minimalPostPackage();
    mutate(input);

    const result = parseWireEdmPostPackage(JSON.stringify(input));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected package parsing to fail.');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code, path }));
  });

  it('rejects invalid record keys at every extensible package record', () => {
    const input = minimalPostPackage();
    Object.assign(input.manifest.properties, { 'INVALID PROPERTY': input.manifest.properties.coordinatePrecision });
    Object.assign(input.dialect.commands, { 'INVALID COMMAND': input.dialect.commands['program.end'] });
    Object.assign(input.dialect.commands['distance.absolute'].parameters, {
      'INVALID PARAMETER': { type: 'string', role: 'none', description: 'Invalid key fixture.' }
    });
    Object.assign(input.fixtures[0].properties, { 'INVALID FIXTURE PROPERTY': true });

    const result = parseWireEdmPostPackage(JSON.stringify(input));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected package parsing to fail.');
    expect(result.diagnostics.map(({ path }) => path)).toEqual(expect.arrayContaining([
      '/manifest/properties/INVALID PROPERTY',
      '/dialect/commands/INVALID COMMAND',
      '/dialect/commands/distance.absolute/parameters/INVALID PARAMETER',
      '/fixtures/0/properties/INVALID FIXTURE PROPERTY'
    ]));
  });

  it('rejects author-defined regular expressions instead of executing them', () => {
    const input = minimalPostPackage();
    Object.assign(input.manifest.properties.coordinatePrecision, { pattern: '(a+)+$' });
    Object.assign(input.dialect.commands['distance.absolute'].parameters, {
      text: { type: 'string', role: 'none', description: 'Unsafe pattern fixture.', pattern: '[' }
    });

    const result = parseWireEdmPostPackage(JSON.stringify(input));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected package parsing to fail.');
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/manifest/properties/coordinatePrecision' }),
      expect.objectContaining({ path: '/dialect/commands/distance.absolute/parameters/text' })
    ]));
  });

  it('requires exact placeholders and closed motion roles instead of inferring parameter names', () => {
    const input = minimalPostPackage();
    input.dialect.commands['motion.linear'] = {
      template: 'G1 X{x} Y{y}',
      parameters: {
        x: { type: 'number', role: 'motion.end-x', description: 'X endpoint.', format: coordinateFormat() },
        y: { type: 'number', role: 'motion.end-x', description: 'Incorrect duplicate role.', format: coordinateFormat() }
      },
      effects: ['position.changed'],
      requires: [],
      evidenceRefs: ['robofil-program']
    };
    const result = parseWireEdmPostPackage(JSON.stringify(input));

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'POST_PACKAGE_COMMAND_PARAMETER_INVALID' }]
    });
  });

  it('rejects dialect and fixture evidence references that do not exist', () => {
    const input = minimalPostPackage();
    input.evidence[0].sourceRef = 'missing-source';
    input.dialect.commands['distance.absolute'].evidenceRefs = ['missing-manual'];
    input.fixtures[0].evidenceRefs = ['missing-test-evidence'];

    const result = parseWireEdmPostPackage(JSON.stringify(input));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected package parsing to fail.');
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'POST_PACKAGE_SOURCE_NOT_FOUND',
        path: '/evidence/0/sourceRef'
      }),
      expect.objectContaining({
        code: 'POST_PACKAGE_EVIDENCE_NOT_FOUND',
        path: '/dialect/commands/distance.absolute/evidenceRefs/0'
      }),
      expect.objectContaining({
        code: 'POST_PACKAGE_EVIDENCE_NOT_FOUND',
        path: '/fixtures/0/evidenceRefs/0'
      })
    ]));
  });

  it('preserves legacy arc-package parsing and rejects direction on non-circular commands', () => {
    const input = minimalPostPackage();
    const command = input.dialect.commands['motion.linear'];
    command.arcDirection = 'clockwise';
    expect(parseWireEdmPostPackage(JSON.stringify(input))).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'POST_PACKAGE_COMMAND_PARAMETER_INVALID', path: '/dialect/commands/motion.linear/arcDirection' })]
    });

    command.template = 'G2 X{x} Y{y} I{i} J{j}';
    for (const [name, role] of [['i', 'motion.center-x'], ['j', 'motion.center-y']] as const) {
      command.parameters[name] = {
        type: 'number', role, description: 'Arc center.', format: coordinateFormat(),
        centerReference: { kind: 'fixed', mode: 'absolute' }
      };
    }
    delete command.arcDirection;
    expect(parseWireEdmPostPackage(JSON.stringify(input))).toMatchObject({ ok: true });

    command.arcDirection = 'clockwise';
    expect(parseWireEdmPostPackage(JSON.stringify(input))).toMatchObject({ ok: true });
  });

  it('rejects dangling evidence targets and command citations to unrelated claims', () => {
    const input = minimalPostPackage();
    input.evidence[0].supports = [
      { kind: 'command', id: 'program.end' },
      { kind: 'command', id: 'missing.command' }
    ];

    const result = parseWireEdmPostPackage(JSON.stringify(input));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected package parsing to fail.');
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'POST_PACKAGE_EVIDENCE_TARGET_NOT_FOUND',
        path: '/evidence/0/supports/1/id'
      }),
      expect.objectContaining({
        code: 'POST_PACKAGE_EVIDENCE_SCOPE_MISMATCH',
        path: '/dialect/commands/distance.absolute/evidenceRefs/0'
      })
    ]));
  });

  it('rejects command evidence that does not cover every declared controller and machine target', () => {
    const input = minimalPostPackage();
    input.manifest.targets.push({
      manufacturer: 'Charmilles',
      controllerManufacturer: 'Charmilles',
      controller: 'Robofil New',
      firmware: { status: 'unknown' },
      machineModels: ['Robofil 200']
    });
    input.evidence[0].appliesTo.controllerModels = ['Unrelated Controller'];
    input.evidence[0].appliesTo.machineModels = [];

    const result = parseWireEdmPostPackage(JSON.stringify(input));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected package parsing to fail.');
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'POST_PACKAGE_EVIDENCE_SCOPE_MISMATCH',
        path: '/dialect/commands/distance.absolute/evidenceRefs/0',
        message: expect.stringContaining('not applicable to any declared controller target')
      }),
      expect.objectContaining({
        code: 'POST_PACKAGE_EVIDENCE_SCOPE_MISMATCH',
        path: '/dialect/commands/distance.absolute/evidenceRefs',
        message: expect.stringContaining('Robofil New / Robofil 200')
      })
    ]));
  });

  it('returns a precise JSON diagnostic for malformed input', () => {
    expect(parseWireEdmPostPackage('{')).toEqual({
      ok: false,
      diagnostics: [
        {
          code: 'POST_PACKAGE_JSON_INVALID',
          path: '',
          message: 'Post package is not valid JSON.'
        }
      ]
    });
  });
});

function coordinateFormat() {
  return {
    style: 'fixed' as const,
    fractionDigits: { kind: 'property' as const, property: 'coordinatePrecision' },
    decimalSeparator: '.' as const,
    trimTrailingZeros: true,
    negativeZero: 'zero' as const
  };
}
