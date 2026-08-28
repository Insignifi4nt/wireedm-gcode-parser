import type { WireEdmPostPackageValue } from '../postPackageSchema';

export function minimalPostPackage(): WireEdmPostPackageValue {
  return {
    format: 'wire-edm-post',
    schemaVersion: 1,
    manifest: {
      id: 'example.robofil-classic',
      name: 'Example Robofil Classic',
      version: '1.0.0',
      engineApiVersion: '1',
      description: 'Minimal deterministic fixture post.',
      targets: [
        {
          manufacturer: 'Charmilles',
          controller: 'Robofil Classic',
          machineModels: ['Robofil 100']
        }
      ],
      capabilities: {
        circularInterpolation: 'none',
        controllerCompensation: 'left-right',
        operations: 'single',
        passes: 'single',
        threading: 'manual',
        wireSeparation: false,
        programStops: true,
        taperAxes: false,
        technologySelection: false,
        initialWirePosition: true
      },
      execution: {
        initialWirePosition: 'required',
        compensationLifecycle: 'controller-native-program',
        compensationRequiredForEveryOperation: true
      },
      properties: {
        coordinatePrecision: {
          type: 'integer',
          description: 'Digits after the decimal separator.',
          required: true,
          minimum: 0,
          maximum: 6,
          suggestedValue: 3
        }
      }
    },
    dialect: {
      id: 'charmilles.robofil-classic.local',
      description: 'Vocabulary evidenced for the local Robofil Classic controller only.',
      commands: {
        'distance.absolute': {
          template: 'G90',
          parameters: {},
          effects: ['distance.absolute'],
          requires: [],
          evidenceRefs: ['robofil-program']
        },
        'motion.linear': {
          template: 'G1 X{x} Y{y}',
          parameters: {
            x: {
              type: 'number',
              role: 'motion.end-x',
              description: 'X endpoint coordinate.'
            },
            y: {
              type: 'number',
              role: 'motion.end-y',
              description: 'Y endpoint coordinate.'
            }
          },
          effects: ['position.changed'],
          requires: ['distance.absolute'],
          evidenceRefs: ['robofil-program']
        },
        'program.end': {
          template: 'M02',
          parameters: {},
          effects: ['program.ended'],
          requires: [],
          evidenceRefs: ['robofil-program']
        }
      }
    },
    source: {
      language: 'javascript',
      entrypoint: 'createPost',
      code: [
        'export function createPost(api) {',
        '  return {',
        '    onEvent(event) {',
        "      if (event.kind === 'program-start') return api.emitCommand('distance.absolute', {});",
        "      if (event.kind === 'position') return api.emitMotion('motion.linear', { x: event.to.x, y: event.to.y });",
        "      if (event.kind === 'motion' && event.motion === 'linear') return api.emitMotion('motion.linear', { x: event.end.x, y: event.end.y });",
        "      if (event.kind === 'motion') throw new Error('Circular motion is not supported.');",
        "      if (event.kind === 'program-end') return api.emitCommand('program.end', {});",
        "      api.consume('No controller block is required for this event.');",
        '    }',
        '  };',
        '}'
      ].join('\n')
    },
    sources: [
      {
        id: 'source.robofil-program',
        kind: 'verified-program',
        name: 'Local physically verified Robofil 100 program',
        uri: 'evidence/local-robofil-100-program.iso',
        mediaType: 'text/plain',
        contentSha256: '1'.repeat(64),
        recordedAt: '2026-07-13T00:00:00.000Z',
        description: 'Program and cut result recorded on the local Robofil 100.'
      }
    ],
    evidence: [
      {
        id: 'robofil-program',
        sourceRef: 'source.robofil-program',
        selector: {
          location: 'G90 setup and M02 ending',
          exact: 'G90 ... M02'
        },
        claim: 'The evidenced local program uses G90 setup, G1 linear motion, and M02 program ending.',
        supports: [
          { kind: 'command', id: 'distance.absolute' },
          { kind: 'command', id: 'motion.linear' },
          { kind: 'command', id: 'program.end' }
        ],
        appliesTo: {
          controllerModels: ['Robofil Classic'],
          machineModels: ['Robofil 100']
        },
        review: {
          status: 'reviewed',
          reviewer: 'local-machine-owner',
          reviewedAt: '2026-07-13T00:00:00.000Z'
        }
      }
    ],
    fixtures: [
      {
        id: 'single-closed-contour',
        description: 'One linear closed contour without threading.',
        planFixture: 'core.single-closed-contour.v1',
        properties: { coordinatePrecision: 3 },
        expectedProgram: [
          'G90',
          'G1 X10 Y0',
          'G1 X10 Y10',
          'G1 X0 Y10',
          'G1 X0 Y0',
          'M02'
        ].join('\n'),
        evidenceRefs: ['robofil-program']
      }
    ]
  };
}
