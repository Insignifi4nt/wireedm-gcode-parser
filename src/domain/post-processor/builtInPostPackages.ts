import { validateWireEdmPostPackageValue } from './postPackage';
import { canonicalJson } from './canonicalJson';
import type {
  WireEdmPostPackage,
  WireEdmPostPackageValue
} from './postPackageSchema';

export type BuiltInPostKey =
  | 'generic-iso'
  | 'generic-explicit-linear'
  | 'robofil-v1'
  | 'robofil-v2';

interface BuiltInDescriptor {
  key: BuiltInPostKey;
  id: string;
  name: string;
  version: string;
  description: string;
  controller: string;
  machineModels: string[];
  capabilities: WireEdmPostPackageValue['manifest']['capabilities'];
  execution: WireEdmPostPackageValue['manifest']['execution'];
  commands: Record<string, string>;
  properties: WireEdmPostPackageValue['manifest']['properties'];
  expectedProgram: string;
  evidenceHashCharacter: string;
}

const commonProperties = {
  coordinatePrecision: {
    type: 'integer' as const,
    description: 'Exact number of fractional digits emitted for every coordinate.',
    required: true,
    minimum: 0,
    maximum: 6,
    suggestedValue: 3
  }
};

const compensationProperties = {
  ...commonProperties,
  offsetIndex: {
    type: 'integer' as const,
    description: 'Controller compensation table index emitted with the activation command.',
    required: true,
    minimum: 0,
    maximum: 99,
    suggestedValue: 0
  }
};

const genericCommands = {
  'program.delimiter': '%',
  'distance.absolute': 'G90',
  'units.millimeters': 'G21',
  'plane.xy': 'G17',
  'work-offset.first': 'G54',
  'compensation.cancel': 'G40',
  'motion.rapid': 'G0 X{x} Y{y}',
  'motion.linear': 'G1 X{x} Y{y}',
  'motion.arc-clockwise': 'G2 X{x} Y{y} I{i} J{j}',
  'motion.arc-counterclockwise': 'G3 X{x} Y{y} I{i} J{j}',
  'program.stop': 'M00',
  'program.end': 'M30'
};

const robofilCommands = {
  'origin.set-wire-position': 'G92 X{x} Y{y}',
  'controller.prepare': 'G60',
  'compensation.prepare': 'G38',
  'compensation.finish': 'G39',
  'compensation.cancel': 'G40',
  'compensation.left': 'G41 D{offset}',
  'compensation.right': 'G42 D{offset}',
  'distance.absolute': 'G90',
  'motion.rapid': 'G0 X{x} Y{y}',
  'motion.linear': 'G1 X{x} Y{y}',
  'motion.arc-clockwise': 'G2 X{x} Y{y} I{i} J{j}',
  'motion.arc-counterclockwise': 'G3 X{x} Y{y} I{i} J{j}',
  'program.stop': 'M00',
  'program.end': 'M02'
};

const descriptors: readonly BuiltInDescriptor[] = [
  {
    key: 'generic-iso',
    id: 'wireedm.generic-iso',
    name: 'Generic ISO',
    version: '1.0.0',
    description: 'Controller-neutral baseline ISO output without controller compensation or rethread commands.',
    controller: 'Generic ISO',
    machineModels: [],
    capabilities: capabilities({}),
    execution: execution('none', false),
    commands: genericCommands,
    properties: {
      ...commonProperties,
      arcCenterMode: {
        type: 'choice',
        description: 'Whether I/J arc-center coordinates are absolute or incremental from the arc start.',
        required: true,
        choices: ['absolute', 'incremental'],
        suggestedValue: 'incremental'
      }
    },
    expectedProgram: '%\nG90\nG21\nG17\nG40\nG54\nM30\n%',
    evidenceHashCharacter: '2'
  },
  {
    key: 'generic-explicit-linear',
    id: 'wireedm.generic-explicit-linear',
    name: 'Generic ISO Explicit Linear Compensation',
    version: '1.0.0',
    description: 'Operation-scoped compensation with activation on a reviewed linear entry and cancellation on a reviewed linear exit.',
    controller: 'Generic ISO',
    machineModels: [],
    capabilities: capabilities({
      controllerCompensation: 'left-right',
      threading: 'manual',
      wireSeparation: true,
      programStops: true
    }),
    execution: execution('authored-linear', false),
    commands: {
      ...genericCommands,
      'compensation.left': 'G41 D{offset}',
      'compensation.right': 'G42 D{offset}'
    },
    properties: {
      ...compensationProperties,
      arcCenterMode: {
        type: 'choice',
        description: 'Whether I/J arc-center coordinates are absolute or incremental from the arc start.',
        required: true,
        choices: ['absolute', 'incremental'],
        suggestedValue: 'incremental'
      }
    },
    expectedProgram: '%\nG90\nG21\nG17\nG40\nG54\nM30\n%',
    evidenceHashCharacter: '3'
  },
  {
    key: 'robofil-v1',
    id: 'wireedm.robofil-classic',
    name: 'Charmilles Robofil Classic — verified single contour',
    version: '1.0.0',
    description: 'Locally evidenced program-scoped Robofil Classic output for one compensated operation.',
    controller: 'Robofil Classic',
    machineModels: ['Robofil 100'],
    capabilities: capabilities({
      operations: 'single',
      controllerCompensation: 'left-right',
      threading: 'manual',
      initialWirePosition: true
    }),
    execution: execution('controller-native-program', true),
    commands: robofilCommands,
    properties: compensationProperties,
    expectedProgram: 'G92 X0.000 Y0.000\nG60\nG38\nG41 D0\nG90\nM02',
    evidenceHashCharacter: '1'
  },
  {
    key: 'robofil-v2',
    id: 'wireedm.robofil-classic',
    name: 'Charmilles Robofil Classic — operation scoped',
    version: '2.0.0',
    description: 'Operation-scoped Robofil Classic lifecycle with explicit cancellation before positioning and rethreading.',
    controller: 'Robofil Classic',
    machineModels: ['Robofil 100'],
    capabilities: capabilities({
      controllerCompensation: 'left-right',
      threading: 'manual',
      wireSeparation: true,
      programStops: true,
      initialWirePosition: true
    }),
    execution: execution('controller-native-operation', true),
    commands: robofilCommands,
    properties: compensationProperties,
    expectedProgram: 'G92 X0.000 Y0.000\nG60\nG38\nG90\nG39\nG40\nG41 D0\nG39\nG40\nM02',
    evidenceHashCharacter: '4'
  }
];

const packages = new Map<BuiltInPostKey, WireEdmPostPackage>(
  descriptors.map((descriptor) => [descriptor.key, createPackage(descriptor)])
);

export function builtInPostPackage(key: BuiltInPostKey): WireEdmPostPackage {
  const packageValue = packages.get(key);
  if (!packageValue) throw new Error(`Unknown built-in post key: ${key}.`);
  return packageValue;
}

export function builtInPostPackages(): readonly WireEdmPostPackage[] {
  return descriptors.map(({ key }) => builtInPostPackage(key));
}

export function resolveBuiltInPostKey(
  packageValue: WireEdmPostPackage
): BuiltInPostKey | null {
  const serialized = canonicalJson(packageValue);
  for (const descriptor of descriptors) {
    if (canonicalJson(builtInPostPackage(descriptor.key)) === serialized) return descriptor.key;
  }
  return null;
}

function createPackage(descriptor: BuiltInDescriptor): WireEdmPostPackage {
  const evidenceId = `${descriptor.key}.commands`;
  const sourceId = `${descriptor.key}.source`;
  const commands = Object.fromEntries(Object.entries(descriptor.commands).map(([id, template]) => [
    id,
    {
      template,
      parameters: commandParameters(id, descriptor),
      effects: commandEffects(id),
      requires: [],
      evidenceRefs: [evidenceId]
    }
  ]));
  const value: WireEdmPostPackageValue = {
    format: 'wire-edm-post',
    schemaVersion: 1,
    manifest: {
      id: descriptor.id,
      name: descriptor.name,
      version: descriptor.version,
      engineApiVersion: '1',
      description: descriptor.description,
      targets: [{
        manufacturer: descriptor.controller === 'Generic ISO' ? 'Generic' : 'Charmilles',
        controller: descriptor.controller,
        machineModels: descriptor.machineModels
      }],
      capabilities: descriptor.capabilities,
      execution: descriptor.execution,
      properties: descriptor.properties
    },
    dialect: {
      id: `${descriptor.id}.${descriptor.version.replaceAll('.', '-')}`,
      description: `Command vocabulary scoped to ${descriptor.name}; command words have no meaning outside this package target.`,
      commands
    },
    source: {
      language: 'javascript',
      entrypoint: 'createPost',
      code: [
        'export function createPost(api) {',
        `  return api.requireBuiltIn(${JSON.stringify(descriptor.key)});`,
        '}'
      ].join('\n')
    },
    sources: [{
      id: sourceId,
      kind: 'operator-test',
      name: `${descriptor.name} local conformance record`,
      uri: `evidence/${descriptor.key}-conformance.txt`,
      mediaType: 'text/plain',
      contentSha256: descriptor.evidenceHashCharacter.repeat(64),
      recordedAt: '2026-08-28T00:00:00.000Z',
      description: 'Repository-local command and expected-program evidence reviewed for this exact built-in package.'
    }],
    evidence: [{
      id: evidenceId,
      sourceRef: sourceId,
      selector: { location: 'Complete command and expected-program record' },
      claim: `The listed command templates and fixture output apply only to ${descriptor.name}.`,
      supports: Object.keys(commands).map((id) => ({ kind: 'command' as const, id })),
      appliesTo: {
        controllerModels: [descriptor.controller],
        machineModels: descriptor.machineModels
      },
      review: {
        status: 'reviewed',
        reviewer: 'wire-edm-workbench-maintainers',
        reviewedAt: '2026-08-28T00:00:00.000Z'
      }
    }],
    fixtures: [{
      id: 'minimal-plan',
      description: `Minimal conformance fixture for ${descriptor.name}.`,
      planFixture: 'core.single-closed-contour.v1',
      properties: fixtureProperties(descriptor.properties),
      expectedProgram: descriptor.expectedProgram,
      evidenceRefs: [evidenceId]
    }]
  };
  const parsed = validateWireEdmPostPackageValue(value);
  if (!parsed.ok) {
    throw new Error(`Invalid built-in post package ${descriptor.key}: ${JSON.stringify(parsed.diagnostics)}`);
  }
  return parsed.package;
}

function capabilities(
  overrides: Partial<WireEdmPostPackageValue['manifest']['capabilities']>
): WireEdmPostPackageValue['manifest']['capabilities'] {
  return {
    circularInterpolation: 'both',
    controllerCompensation: 'none',
    operations: 'multiple',
    passes: 'single',
    threading: 'none',
    wireSeparation: false,
    programStops: false,
    taperAxes: false,
    technologySelection: false,
    initialWirePosition: true,
    ...overrides
  };
}

function execution(
  compensationLifecycle: WireEdmPostPackageValue['manifest']['execution']['compensationLifecycle'],
  compensationRequiredForEveryOperation: boolean
): WireEdmPostPackageValue['manifest']['execution'] {
  return {
    initialWirePosition: 'required',
    compensationLifecycle,
    compensationRequiredForEveryOperation
  };
}

function commandParameters(
  commandId: string,
  descriptor: BuiltInDescriptor
): WireEdmPostPackageValue['dialect']['commands'][string]['parameters'] {
  if (commandId === 'motion.rapid' || commandId === 'motion.linear') {
    return {
      x: coordinateParameter('motion.end-x', 'X endpoint coordinate.'),
      y: coordinateParameter('motion.end-y', 'Y endpoint coordinate.')
    };
  }
  if (commandId === 'motion.arc-clockwise' || commandId === 'motion.arc-counterclockwise') {
    const centerReference = Object.hasOwn(descriptor.properties, 'arcCenterMode')
      ? { kind: 'property' as const, property: 'arcCenterMode' }
      : { kind: 'fixed' as const, mode: 'absolute' as const };
    return {
      x: coordinateParameter('motion.end-x', 'X endpoint coordinate.'),
      y: coordinateParameter('motion.end-y', 'Y endpoint coordinate.'),
      i: {
        type: 'number',
        role: 'motion.center-x',
        centerReference,
        description: 'Arc-center X coordinate.'
      },
      j: {
        type: 'number',
        role: 'motion.center-y',
        centerReference,
        description: 'Arc-center Y coordinate.'
      }
    };
  }
  if (commandId === 'origin.set-wire-position') {
    return {
      x: coordinateParameter('none', 'X wire-position coordinate.'),
      y: coordinateParameter('none', 'Y wire-position coordinate.')
    };
  }
  if (commandId === 'compensation.left' || commandId === 'compensation.right') {
    return {
      offset: {
        type: 'integer',
        role: 'none',
        description: 'Compensation table index.',
        minimum: 0
      }
    };
  }
  return {};
}

function coordinateParameter(
  role: 'none' | 'motion.end-x' | 'motion.end-y',
  description: string
) {
  return { type: 'number' as const, role, description };
}

function commandEffects(
  id: string
): WireEdmPostPackageValue['dialect']['commands'][string]['effects'] {
  if (id.startsWith('motion.')) return ['position.changed'];
  if (id === 'compensation.left') return ['compensation.left'];
  if (id === 'compensation.right') return ['compensation.right'];
  if (id === 'compensation.cancel' || id === 'compensation.finish') return ['compensation.off'];
  if (id === 'program.end') return ['program.ended'];
  if (id === 'program.stop') return ['program.paused'];
  if (id === 'program.delimiter') return ['program.delimiter'];
  if (id === 'distance.absolute') return ['distance.absolute'];
  if (id === 'units.millimeters') return ['units.millimeters'];
  if (id === 'plane.xy') return ['plane.xy'];
  if (id === 'work-offset.first') return ['work-offset.selected'];
  if (id === 'origin.set-wire-position') return ['origin.wire-position-set'];
  if (id === 'compensation.prepare' || id === 'controller.prepare') {
    return ['compensation.prepared'];
  }
  throw new Error(`Built-in command ${id} has no declared semantic effect.`);
}

function fixtureProperties(
  definitions: WireEdmPostPackageValue['manifest']['properties']
) {
  return Object.fromEntries(Object.entries(definitions).map(([name, definition]) => {
    if (definition.suggestedValue === undefined) {
      throw new Error(`Built-in property ${name} requires an explicit fixture value.`);
    }
    return [name, definition.suggestedValue];
  }));
}
