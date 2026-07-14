import { createHash } from 'node:crypto';
import { readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createServer } from 'vite';

const DEFAULT_SOURCE = '/mnt/c/Users/cristian/Documents/Catia/COGEME/Prisma/Prisma fixa 1 cog.dxf';
const OUTPUT_DIRECTORY = 'artifacts/robofil-v2/prisma-fixa-1-cog';
const FIXED_TIMESTAMP = new Date('2026-07-14T00:00:00.000Z');
const EPSILON = 1e-6;
const VERIFICATION_COMMANDS = [
  'npm test -- --run src/domain/compensation/__tests__/validateCompensatedExport.test.ts src/domain/post/__tests__/upidMachinePost.test.ts src/domain/dxf/__tests__/importDxfProject.test.ts src/domain/path-editor/__tests__/pathDocumentOperations.test.ts src/domain/editor/__tests__/previewGeometry.test.ts src/__tests__/editorPathNativeDraft.test.tsx src/__tests__/appWorkbenchDashboard.test.tsx',
  'npm run build',
  'npm run artifacts:prisma'
];

const sourcePath = path.resolve(process.argv[2] ?? DEFAULT_SOURCE);
const outputDirectory = path.resolve(process.cwd(), OUTPUT_DIRECTORY);
const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true }
});

try {
  const [
    { parseDxf },
    { dxfEntitiesToUpidDocument },
    { initializeProjectCompensationIntents },
    machineProfiles,
    { serializeMachineProfileFile },
    operations,
    { emptyBounds, mergeBounds },
    { composeUpidGCodeExport }
  ] = await Promise.all([
    vite.ssrLoadModule('/src/domain/dxf/parseDxf.ts'),
    vite.ssrLoadModule('/src/domain/dxf/dxfToUpid.ts'),
    vite.ssrLoadModule('/src/domain/compensation/intent.ts'),
    vite.ssrLoadModule('/src/domain/machine/machineProfiles.ts'),
    vite.ssrLoadModule('/src/domain/machine/machineProfileFile.ts'),
    vite.ssrLoadModule('/src/domain/path-editor/pathDocumentOperations.ts'),
    vite.ssrLoadModule('/src/domain/path-intel/segments.ts'),
    vite.ssrLoadModule('/src/domain/upid/upidDocument.ts')
  ]);

  const sourceBytes = await readFile(sourcePath);
  const sourceText = sourceBytes.toString('utf8');
  const parsed = parseDxf(sourceText);
  assert(parsed.entities.length === 24, `Expected 24 DXF entities, received ${parsed.entities.length}.`);

  const candidateProfile = machineProfiles.createCharmillesRobofil100V2CandidateProfile();
  const verifiedForArtifactGeneration = machineProfiles.markMachineProfileUserVerified(
    candidateProfile,
    FIXED_TIMESTAMP
  );
  let document = dxfEntitiesToUpidDocument(parsed.entities, {}, {
    appliedUnits: {
      basis: 'user-confirmed',
      confirmed: true,
      confirmedAt: FIXED_TIMESTAMP.toISOString(),
      label: 'millimeters',
      scaleToMillimeters: 1
    },
    coordinateScaleToMillimeters: 1,
    drawing: parsed.drawing,
    fileName: path.basename(sourcePath),
    importedAt: FIXED_TIMESTAMP.toISOString(),
    importWarnings: parsed.warnings,
    unitDeclaration: parsed.unitDeclaration,
    units: parsed.units
  });

  document = operations.translatePathDocument(document, { x: -32.5, y: 64.5 });
  document = initializeProjectCompensationIntents(document, verifiedForArtifactGeneration);
  assert(document.plan.operations.length === 3, `Expected 3 closed contours, received ${document.plan.operations.length}.`);

  const holes = document.plan.operations.filter((operation) => operation.classification === 'hole');
  const exteriors = document.plan.operations.filter((operation) => operation.classification === 'exterior');
  assert(holes.length === 2, `Expected 2 hole operations, received ${holes.length}.`);
  assert(exteriors.length === 1, `Expected 1 exterior operation, received ${exteriors.length}.`);

  for (const hole of holes) {
    document = requiredDocument(
      operations.setCircleOperationCenterPierceLeadIn(document, hole.id),
      `Could not add the circle-center lead to ${hole.displayName}.`
    );
  }
  const exterior = document.plan.operations.find((operation) => operation.classification === 'exterior');
  document = requiredDocument(
    operations.setPathOperationManualLeadIn(document, exterior.id, { x: 37.5, y: 64.5 }),
    'Could not add the exterior approach lead.'
  );

  const placement = inspectPlacement(document, emptyBounds, mergeBounds);
  assertApprox(placement.bounds.minX, -32.5, 'minimum X');
  assertApprox(placement.bounds.maxX, 32.5, 'maximum X');
  assertApprox(placement.bounds.minY, 0, 'minimum Y');
  assertApprox(placement.bounds.maxY, 64.5, 'maximum Y');
  assertApprox((placement.bounds.minX + placement.bounds.maxX) / 2, 0, 'X centre');
  assertApprox(placement.bounds.minY, 0, 'bottom-on-Y placement');
  assertPointSetsEqual(placement.holeCenters, [
    { x: -17.5, y: 39.6 },
    { x: 17.5, y: 39.6 }
  ], 'hole centres');

  const recommended = buildReadyArtifact(
    'prisma-fixa-1-cog.robofil-v2-recommended.iso',
    document,
    verifiedForArtifactGeneration,
    composeUpidGCodeExport,
    operations.derivePlannedRapidRoutes
  );
  const firstRapid = recommended.exportResult.post.blocks.find((block) => block.kind === 'rapid');
  assert(firstRapid?.startPoint, 'The recommended program has no initial rapid source.');
  assertPoint(firstRapid.startPoint, { x: 0, y: 0 }, 'initial rapid source');
  assert(
    placement.holeCenters.some((center) => pointsClose(firstRapid.endPoint, center)),
    'The recommended program does not start by rapidly positioning to a hole centre.'
  );

  const currentHoles = document.plan.operations.filter((operation) => operation.classification === 'hole');
  const oppositeHoleFirstDocument = requiredDocument(
    operations.movePathOperation(document, currentHoles[1].id, -1),
    'Could not create the opposite-hole-first route variant.'
  );
  const oppositeHoleFirst = buildReadyArtifact(
    'prisma-fixa-1-cog.robofil-v2-opposite-hole-first.iso',
    oppositeHoleFirstDocument,
    verifiedForArtifactGeneration,
    composeUpidGCodeExport,
    operations.derivePlannedRapidRoutes
  );

  const exteriorReversedDocument = requiredDocument(
    operations.reversePathOperation(document, exterior.id),
    'Could not create the exterior-reversed direction variant.'
  );
  const exteriorReversed = buildReadyArtifact(
    'prisma-fixa-1-cog.robofil-v2-exterior-reversed.iso',
    exteriorReversedDocument,
    verifiedForArtifactGeneration,
    composeUpidGCodeExport,
    operations.derivePlannedRapidRoutes
  );
  assert(
    recommended.exportResult.body !== exteriorReversed.exportResult.body,
    'Reversing the exterior did not change the generated program.'
  );

  const verifiedV1 = machineProfiles.createVerifiedCharmillesRobofil100Profile(
    'charmilles-robofil-100-verified-v1-comparison',
    FIXED_TIMESTAMP
  );
  const v1Blocked = composeUpidGCodeExport(document, { machine: verifiedV1 });
  assert(!v1Blocked.canDownload, 'The physically verified v1 envelope unexpectedly accepted three contours.');

  const genericMachine = machineProfiles.createBlankMachineProfile('generic-iso-comparison');
  const wireCentreDocument = initializeProjectCompensationIntents(document, genericMachine);
  const genericComparison = composeUpidGCodeExport(wireCentreDocument, { machine: genericMachine });
  assert(genericComparison.canDownload, 'The uncompensated generic comparison program was blocked.');

  await mkdir(outputDirectory, { recursive: true });
  const existingOutputEntries = await readdir(outputDirectory, { withFileTypes: true });
  await Promise.all(
    existingOutputEntries
      .filter((entry) => !entry.isDirectory())
      .map((entry) => rm(path.join(outputDirectory, entry.name), { force: true }))
  );

  const programArtifacts = [recommended, oppositeHoleFirst, exteriorReversed];
  for (const artifact of programArtifacts) {
    await writeFile(path.join(outputDirectory, artifact.fileName), artifact.exportResult.program.text, 'utf8');
  }
  const genericFileName = 'prisma-fixa-1-cog.generic-wire-centre-reference.iso';
  await writeFile(path.join(outputDirectory, genericFileName), genericComparison.program.text, 'utf8');

  const candidateProfileFileName = 'charmilles-robofil-100-v2-candidate.wireedm-machine.json';
  await writeFile(
    path.join(outputDirectory, candidateProfileFileName),
    serializeMachineProfileFile(candidateProfile, FIXED_TIMESTAMP),
    'utf8'
  );

  const v1ReportFileName = 'robofil-v1-multicontour-blocked.json';
  await writeJson(path.join(outputDirectory, v1ReportFileName), {
    canDownload: v1Blocked.canDownload,
    meaning: 'This is a limitation of Wire EDM Workbench\'s physically verified v1 post envelope, not evidence that the Robofil controller fundamentally forbids multiple contours.',
    diagnostics: v1Blocked.blockingDiagnostics
  });

  const filesForHashing = [
    ...programArtifacts.map((artifact) => artifact.fileName),
    genericFileName,
    candidateProfileFileName,
    v1ReportFileName
  ];
  const outputHashes = Object.fromEntries(await Promise.all(filesForHashing.map(async (fileName) => [
    fileName,
    sha256(await readFile(path.join(outputDirectory, fileName)))
  ])));

  const manifest = {
    format: 'wire-edm-robofil-v2-test-artifacts',
    schemaVersion: 1,
    generatedAt: FIXED_TIMESTAMP.toISOString(),
    source: {
      path: path.basename(sourcePath),
      fileName: path.basename(sourcePath),
      sha256: sha256(sourceBytes),
      entityCount: parsed.entities.length,
      unitDeclaration: parsed.unitDeclaration,
      appliedUnits: 'User-confirmed millimetres (scale 1). The DXF itself has no usable unit declaration.'
    },
    placement,
    lifecycle: {
      profile: candidateProfile.name,
      warning: 'Candidate only. Verify in controller graphics/SIM mode and a supervised dry run before cutting.',
      boundary: 'Every operation emits G39 then G40; all G0 travel occurs in G40; G41/G42 D0 is reapplied before that operation\'s lead and contour; the file ends G39, G40, M02.'
    },
    programs: programArtifacts.map((artifact) => ({
      fileName: artifact.fileName,
      operationOrder: artifact.operationOrder,
      rapidRoutes: artifact.rapidRoutes,
      modalAudit: artifact.modalAudit,
      sha256: outputHashes[artifact.fileName]
    })),
    references: {
      genericWireCentre: {
        fileName: genericFileName,
        purpose: 'Geometry comparison only; no Robofil controller compensation lifecycle.',
        sha256: outputHashes[genericFileName]
      },
      v1BlockedReport: v1ReportFileName,
      importableCandidateProfile: candidateProfileFileName
    },
    verificationCommands: VERIFICATION_COMMANDS,
    outputHashes
  };
  await writeJson(path.join(outputDirectory, 'manifest.json'), manifest);
  await writeFile(path.join(outputDirectory, 'README.txt'), artifactReadme({
    outputDirectory: OUTPUT_DIRECTORY,
    sourcePath: path.basename(sourcePath),
    sourceHash: sha256(sourceBytes),
    manifest
  }), 'utf8');

  process.stdout.write(`${JSON.stringify({
    outputDirectory,
    sourceSha256: sha256(sourceBytes),
    programs: programArtifacts.map((artifact) => artifact.fileName),
    placement
  }, null, 2)}\n`);
} finally {
  await vite.close();
}

function buildReadyArtifact(fileName, document, machine, compose, deriveRoutes) {
  const exportResult = compose(document, { machine });
  assert(exportResult.canDownload, `${fileName} was blocked: ${diagnosticText(exportResult)}.`);
  const modalAudit = auditV2Post(exportResult.post, document.plan.operations.map((operation) => operation.id));
  return {
    document,
    exportResult,
    fileName,
    modalAudit,
    operationOrder: document.plan.operations.map((operation) => ({
      classification: operation.classification,
      direction: operation.direction,
      displayName: operation.displayName,
      operationId: operation.id,
      entryPoint: operation.overrides?.leadIn?.from ?? operation.startPoint,
      leadSource: operation.overrides?.leadIn?.source ?? null
    })),
    rapidRoutes: deriveRoutes(document).map((route) => ({
      operationId: route.operationId,
      startPoint: route.startPoint,
      endPoint: route.endPoint,
      length: round(route.length)
    }))
  };
}

function auditV2Post(post, operationIds) {
  assert(post.status === 'ready', 'Cannot audit a blocked v2 post.');
  const rapidBlocks = post.blocks.filter((block) => block.kind === 'rapid');
  assert(
    rapidBlocks.every((block) => block.compensationBefore === 'G40' && block.compensationAfter === 'G40'),
    'A rapid move was posted while compensation was active.'
  );
  for (const operationId of operationIds) {
    const operationBlocks = post.blocks.filter((block) => block.operationId === operationId);
    const g40Index = operationBlocks.findIndex((block) => block.kind === 'operation-boundary');
    const activationIndex = operationBlocks.findIndex((block) => block.kind === 'compensation-activation');
    const firstCutIndex = operationBlocks.findIndex((block) => block.kind === 'lead-in' || block.kind === 'contour');
    assert(g40Index > 0 && operationBlocks[g40Index - 1].text === 'G39', `${operationId} is missing G39 before G40.`);
    assert(operationBlocks[g40Index].text === 'G40', `${operationId} is missing its G40 boundary.`);
    assert(activationIndex > g40Index, `${operationId} activates compensation before its G40 boundary.`);
    assert(firstCutIndex > activationIndex, `${operationId} cuts before compensation is reapplied.`);
  }
  assert(post.body.split('\n').slice(-3).join('\n') === 'G39\nG40\nM02', 'The program does not end G39, G40, M02.');
  return {
    operationCount: operationIds.length,
    rapidCount: rapidBlocks.length,
    rapidUnderCompensationCount: 0,
    finalBlocks: ['G39', 'G40', 'M02']
  };
}

function inspectPlacement(document, emptyBounds, mergeBounds) {
  const bounds = document.segments.reduce(
    (result, segment) => mergeBounds(result, segment.bounds),
    emptyBounds()
  );
  const holeCenters = document.plan.operations
    .filter((operation) => operation.classification === 'hole')
    .map((operation) => {
      const leadIn = operation.overrides?.leadIn;
      assert(leadIn?.source === 'circle-center', 'A hole operation has no circle-center lead.');
      return { x: round(leadIn.from.x), y: round(leadIn.from.y) };
    })
    .sort((left, right) => left.x - right.x);
  return {
    bounds: Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, round(value)])),
    centre: {
      x: round((bounds.minX + bounds.maxX) / 2),
      y: round((bounds.minY + bounds.maxY) / 2)
    },
    dimensions: {
      width: round(bounds.maxX - bounds.minX),
      height: round(bounds.maxY - bounds.minY)
    },
    holeCenters
  };
}

function artifactReadme({ outputDirectory, sourcePath, sourceHash, manifest }) {
  const programs = manifest.programs.map((program) => `- ${program.fileName}`).join('\n');
  return [
    'Charmilles Robofil 100 v2 multi-contour test pack',
    '',
    `Generated from: ${sourcePath}`,
    `Source SHA-256: ${sourceHash}`,
    `Artifact directory: ${outputDirectory}`,
    '',
    'PLACEMENT (asserted by the generator)',
    '- Part geometry X: -32.500 to +32.500 mm (centred on X0)',
    '- Part geometry Y: 0.000 to 64.500 mm (bottom on Y0)',
    '- Hole centres: X-17.500 Y39.600 and X+17.500 Y39.600',
    '- Every candidate starts its first operation from one of those hole centres.',
    '- The exterior uses an outside lead from X37.500 Y64.500 to its contour start.',
    '',
    'CANDIDATE MACHINE PROGRAMS',
    programs,
    '',
    'The recommended file uses the planner\'s default inside-out-nearest route. The opposite-hole-first',
    'file exercises editable ordering. The exterior-reversed file exercises compensation re-resolution',
    'after direction reversal. All three have been structurally audited so G0 occurs only after G39/G40',
    'and before a fresh G41/G42 D0 activation for the next contour.',
    'Automatic ordering does not yet optimize native-circle circumference starts; exact start/rapid',
    'editing remains available in the editor without overwriting manual circle-start choices.',
    '',
    'DO NOT START WITH A CUT.',
    '1. Import/inspect charmilles-robofil-100-v2-candidate.wireedm-machine.json.',
    '2. Compare the ISO geometry and coordinates against manifest.json.',
    '3. Run controller graphics/SIM mode first (the research notes report SIM,1 for simulation).',
    '4. Confirm G39 really cancels the Robofil compensation mode and G40 clears side selection.',
    '5. Confirm D0 is the intended offset-table selection for this job.',
    '6. Run a supervised air/dry test with generator disabled, then a low-risk material test.',
    '7. Only after those checks should this v2 candidate be treated as machine-verified.',
    '',
    'REFERENCE FILES',
    '- prisma-fixa-1-cog.generic-wire-centre-reference.iso is geometry comparison only; do not use it',
    '  as a Robofil compensated program.',
    '- robofil-v1-multicontour-blocked.json documents why the older app envelope refused this job.',
    '  It does NOT claim that the physical controller forbids multiple contours.',
    '',
    'Regenerate from the repository root with:',
    'npm run artifacts:prisma',
    ''
  ].join('\n');
}

function requiredDocument(value, message) {
  assert(value, message);
  return value;
}

function diagnosticText(exportResult) {
  return exportResult.blockingDiagnostics.map((diagnostic) => diagnostic.message).join(' ') || 'unknown reason';
}

function assertPointSetsEqual(actual, expected, label) {
  assert(actual.length === expected.length, `${label} count differs.`);
  actual.forEach((point, index) => assertPoint(point, expected[index], `${label} ${index + 1}`));
}

function assertPoint(actual, expected, label) {
  assert(actual && pointsClose(actual, expected), `${label} differs: ${JSON.stringify(actual)}.`);
}

function pointsClose(actual, expected) {
  return Boolean(actual) && Math.abs(actual.x - expected.x) <= EPSILON && Math.abs(actual.y - expected.y) <= EPSILON;
}

function assertApprox(actual, expected, label) {
  assert(Math.abs(actual - expected) <= EPSILON, `${label} expected ${expected}, received ${actual}.`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function round(value) {
  return Number(value.toFixed(6));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
