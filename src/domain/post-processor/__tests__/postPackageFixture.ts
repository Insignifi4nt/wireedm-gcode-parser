export function minimalPostPackage() {
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
        circularInterpolation: 'both',
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
        "    onOpen() { api.emitCommand('distance.absolute'); },",
        '    onEvent() {},',
        "    onClose() { api.emitCommand('program.end'); }",
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
        claim: 'The evidenced local program uses G90 setup and M02 program ending.',
        supports: [
          { kind: 'command', id: 'distance.absolute' },
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
        description: 'One closed contour with manual threading.',
        planFixture: 'core.single-closed-contour.v1',
        properties: { coordinatePrecision: 3 },
        expectedProgram: ['G90', 'M02'].join('\n'),
        evidenceRefs: ['robofil-program']
      }
    ]
  };
}
