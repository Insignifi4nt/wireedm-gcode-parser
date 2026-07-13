import { machineSnapshotAuthorizesAutomaticCompensation } from '@/domain/compensation/intent';
import { resolveControllerCompensation } from '@/domain/compensation/resolveControllerCompensation';
import { machineProfileVerificationFingerprint } from '@/domain/machine/machineProfiles';
import {
  createGCodeInterpreterState,
  interpretGCodeBlock
} from '@/domain/editor/gcodeBlockInterpreter';
import {
  preflightPathPlanToGcode,
  postPathPlanToGcode,
  type GcodePostResult,
  type GcodePostedMove,
  type GcodePostedOperation
} from '@/domain/path-intel/postGcode';
import type { PathDiagnostic, PathPlanningDocument, Point2 } from '@/domain/path-intel/types';
import { validateUpidDocument } from '@/domain/upid/validateUpidDocument';
import type { MachineProfile } from '@/domain/workbench/types';

import { stripGcodeComments, validateTemplateModalPolicy } from './templateModalPolicy';

export type GcodePostedBlockKind =
  | 'template'
  | 'setup'
  | 'rapid'
  | 'compensation-activation'
  | 'lead-in'
  | 'contour'
  | 'program-end';

export interface GcodePostedBlock {
  bodyLineIndex: number;
  kind: GcodePostedBlockKind;
  text: string;
  operationId: string | null;
  segmentId: string | null;
  startPoint: Point2 | null;
  endPoint: Point2 | null;
  command: GcodePostedMove['command'] | null;
  compensationBefore: 'G40' | 'G41' | 'G42';
  compensationAfter: 'G40' | 'G41' | 'G42';
}

export interface UpidMachinePostOptions {
  coordinatePrecision?: number;
}

export interface UpidMachinePostResult extends GcodePostResult {
  blocks: GcodePostedBlock[];
  programOwned: boolean;
}

export type VerifiedRobofilPreviewPostBlock = Pick<
  GcodePostedBlock,
  'bodyLineIndex' | 'kind' | 'operationId' | 'startPoint' | 'endPoint'
>;

export function verifiedRobofilPostEnvelopeIsReady(machine: MachineProfile) {
  return hasCurrentRobofilVerification(machine) && matchesVerifiedRobofilEnvelope(machine);
}

export function deriveVerifiedRobofilPreviewPostBlocks(
  document: PathPlanningDocument,
  machine: MachineProfile
): VerifiedRobofilPreviewPostBlock[] | undefined {
  if (
    machine.controller.family !== 'charmilles-robofil-classic' ||
    !verifiedRobofilPostEnvelopeIsReady(machine) ||
    document.plan.operations.length !== 1
  ) {
    return undefined;
  }
  if (!validateUpidDocument(document).valid) return [];

  const operation = document.plan.operations[0];
  const resolution = resolveControllerCompensation({ document, operation });
  if (
    resolution.status === 'blocked' ||
    operation.overrides?.leadIn?.source === 'circle-center' ||
    !validateTemplateModalPolicy({
      machine,
      header: machine.templates.header,
      footer: machine.templates.footer
    }).valid
  ) {
    return [];
  }

  const geometry = preflightPathPlanToGcode(document.plan, document.segments, {
    ...document.options,
    arcCenterMode:
      machine.controller.arcCenterMode === 'absolute' ? 'absolute' : 'incremental',
    coordinatePrecision: machine.output.coordinatePrecision,
    endpointTolerance: effectiveDocumentEndpointTolerance(document),
    coincidenceEpsilon: document.options.coincidenceEpsilon,
    initialPosition: { x: 0, y: 0 },
    operationStartMode: 'linear'
  });
  if (geometry.status === 'blocked') return [];

  const prefixLineCount =
    templateLines(machine.templates.header).length +
    verifiedRobofilStructuredPrefix(machine, resolution.code).length;
  return geometry.operationStartApproaches.flatMap((approach) =>
    approach.operationId && approach.startPoint
      ? [{
          bodyLineIndex: prefixLineCount + approach.bodyLineIndex,
          kind: 'lead-in' as const,
          operationId: approach.operationId,
          startPoint: approach.startPoint,
          endPoint: approach.endPoint
        }]
      : []
  );
}

export function postUpidForMachine(
  document: PathPlanningDocument,
  machine: MachineProfile,
  _options: UpidMachinePostOptions = {}
): UpidMachinePostResult {
  const validation = validateUpidDocument(document);
  if (!validation.valid) {
    return blockedMachinePost(
      validation.blockingDiagnostics,
      machine.controller.family === 'charmilles-robofil-classic'
    );
  }

  const compensatedOperations = document.plan.operations.filter(
    (operation) => operation.compensationIntent?.mode === 'controller'
  );
  if (
    machine.controller.family === 'charmilles-robofil-classic' &&
    compensatedOperations.length === 0
  ) {
    if (!hasCurrentRobofilVerification(machine)) {
      return blockedReason(
        'unverified-machine-profile',
        'Robofil compensated posting requires a current user-verified project machine snapshot.'
      );
    }
    const reason = document.geometryBasis === 'wire-centre' ? 'wire-centre' : 'missing-intent';
    return blockedReason(
      'compensation-resolution-blocked',
      `Controller compensation could not be resolved: ${reason}.`,
      { compensationReason: reason }
    );
  }
  if (compensatedOperations.length === 0) {
    const posted = postPathPlanToGcode(document.plan, document.segments, {
      ...document.options,
      arcCenterMode:
        machineArcCenterMode(machine),
      coordinatePrecision: machine.output.coordinatePrecision,
      endpointTolerance: effectiveDocumentEndpointTolerance(document),
      coincidenceEpsilon: document.options.coincidenceEpsilon
    });
    return machineResultFromGenericPost(posted);
  }

  if (machine.controller.family !== 'charmilles-robofil-classic') {
    return blockedReason(
      'generic-compensation-not-supported',
      'Generic explicit-linear controller compensation is not supported by this milestone.'
    );
  }

  return postVerifiedRobofil(document, machine, compensatedOperations);
}

function postVerifiedRobofil(
  document: PathPlanningDocument,
  machine: MachineProfile,
  compensatedOperations: PathPlanningDocument['plan']['operations']
): UpidMachinePostResult {
  if (!hasCurrentRobofilVerification(machine)) {
    return blockedReason(
      'unverified-machine-profile',
      'Robofil compensated posting requires a current user-verified project machine snapshot.'
    );
  }
  if (!matchesVerifiedRobofilEnvelope(machine)) {
    return blockedReason(
      'unsupported-robofil-post-envelope',
      'This Robofil snapshot is outside the physically verified post-version-1 envelope.'
    );
  }
  if (document.plan.operations.length !== 1 || compensatedOperations.length !== 1) {
    return blockedReason(
      'unsupported-operation-count',
      'The verified program-scoped Robofil lifecycle supports exactly one compensated operation.'
    );
  }

  const templatePolicy = validateTemplateModalPolicy({
    machine,
    header: machine.templates.header,
    footer: machine.templates.footer
  });
  if (!templatePolicy.valid) {
    return blockedReason(
      'template-modal-conflict',
      templatePolicy.diagnostics.map((diagnostic) => diagnostic.message).join(' '),
      { templateDiagnostics: templatePolicy.diagnostics }
    );
  }

  const operation = compensatedOperations[0];
  const resolution = resolveControllerCompensation({ document, operation });
  if (resolution.status === 'blocked') {
    return blockedReason(
      'compensation-resolution-blocked',
      `Controller compensation could not be resolved: ${resolution.reason}.`,
      { compensationReason: resolution.reason }
    );
  }
  if (operation.overrides?.leadIn?.source === 'circle-center') {
    return blockedReason(
      'unsafe-controller-compensation-lead-in',
      'A radial circle-center lead-in is unsafe while Robofil controller compensation is active.'
    );
  }

  const geometry = postPathPlanToGcode(document.plan, document.segments, {
    ...document.options,
    arcCenterMode:
      machine.controller.arcCenterMode === 'absolute' ? 'absolute' : 'incremental',
    coordinatePrecision: machine.output.coordinatePrecision,
    endpointTolerance: effectiveDocumentEndpointTolerance(document),
    coincidenceEpsilon: document.options.coincidenceEpsilon,
    initialPosition: { x: 0, y: 0 },
    operationStartMode: 'linear'
  });
  if (geometry.status === 'blocked') {
    return blockedMachinePost(geometry.diagnostics, true);
  }
  if (geometry.moves.some((move) => move.kind === 'rapid')) {
    return blockedReason(
      'rapid-under-program-compensation',
      'The verified Robofil lifecycle cannot emit a rapid in its compensated program.'
    );
  }

  const headerLines = templateLines(machine.templates.header);
  const footerLines = templateLines(machine.templates.footer);
  const dIndex = machine.compensation.offsetSelection.index;
  const structuredPrefix = verifiedRobofilStructuredPrefix(machine, resolution.code);
  const prefixLines = [...headerLines, ...structuredPrefix];
  const contourLines = geometry.body ? geometry.body.split('\n') : [];
  const lines = [...prefixLines, ...contourLines, ...footerLines, 'M02'];

  const auditIssue = auditVerifiedRobofilProgram({
    lines,
    headerLineCount: headerLines.length,
    structuredPrefix,
    contourLineCount: contourLines.length,
    expectedCompensation: resolution.code,
    dIndex
  });
  if (auditIssue) return blockedReason('post-audit-failed', auditIssue);

  const contourOffset = prefixLines.length;
  const moves = rebaseMoves(geometry.moves, contourOffset);
  const operations = rebaseOperations(geometry.operations, contourOffset, moves);
  if (operations[0]) {
    operations[0].bodyLineStart = headerLines.length + structuredPrefix.length - 2;
  }
  const blocks: GcodePostedBlock[] = [];
  let compensation: 'G40' | 'G41' | 'G42' = 'G40';
  const appendModalBlock = (
    text: string,
    kind: GcodePostedBlockKind,
    operationId: string | null = null
  ) => {
    const after =
      text === resolution.code || text.startsWith(`${resolution.code} `)
        ? resolution.code
        : compensation;
    blocks.push({
      bodyLineIndex: blocks.length,
      kind,
      text,
      operationId,
      segmentId: null,
      startPoint: null,
      endPoint: null,
      command: null,
      compensationBefore: compensation,
      compensationAfter: after
    });
    compensation = after;
  };

  headerLines.forEach((line) => appendModalBlock(line, 'template'));
  appendModalBlock('G92 X0 Y0', 'setup');
  machine.compensation.preActivationCodes.forEach((line) => appendModalBlock(line, 'setup'));
  appendModalBlock('G38', 'compensation-activation', operation.id);
  appendModalBlock(`${resolution.code} D${dIndex}`, 'compensation-activation', operation.id);
  appendModalBlock(machine.controller.distanceMode, 'setup', operation.id);
  moves.forEach((move) => {
    blocks.push({
      bodyLineIndex: move.bodyLineIndex,
      kind:
        move.kind === 'rapid'
          ? 'rapid'
          : move.reason === 'operation-start-approach' || move.reason === 'manual-lead-in'
            ? 'lead-in'
            : 'contour',
      text: move.text,
      operationId: move.operationId,
      segmentId: move.segmentId,
      startPoint: move.startPoint,
      endPoint: move.endPoint,
      command: move.command,
      compensationBefore: compensation,
      compensationAfter: compensation
    });
  });
  footerLines.forEach((line) => appendModalBlock(line, 'template'));
  appendModalBlock('M02', 'program-end');

  return {
    status: 'ready',
    body: lines.join('\n'),
    diagnostics: geometry.diagnostics,
    metrics: geometry.metrics,
    moves,
    operations,
    blocks,
    programOwned: true
  };
}

function hasCurrentRobofilVerification(machine: MachineProfile) {
  const verification = machine.controller.verification;
  return (
    machineSnapshotAuthorizesAutomaticCompensation(machine) &&
    verification.status === 'user-verified' &&
    verification.verifiedFingerprint === machineProfileVerificationFingerprint(machine)
  );
}

function matchesVerifiedRobofilEnvelope(machine: MachineProfile) {
  return (
    machine.controller.family === 'charmilles-robofil-classic' &&
    machine.controller.postVersion === 1 &&
    machine.controller.blockFormatting === 'spaced' &&
    machine.controller.coordinateSystem === 'wire-position-g92' &&
    machine.controller.unitsCode === 'omit' &&
    machine.controller.planeCode === 'omit' &&
    machine.controller.workOffsetCode === 'omit' &&
    machine.controller.distanceMode === 'G90' &&
    machine.controller.arcCenterMode === 'absolute' &&
    machine.controller.programEnd === 'M02' &&
    machine.compensation.activation === 'charmilles-g38' &&
    machine.compensation.cancellation === 'program-end' &&
    machine.compensation.lifecycleScope === 'program' &&
    machine.compensation.offsetSelection.address === 'D' &&
    machine.compensation.offsetSelection.index === 0 &&
    machine.compensation.preActivationCodes.length === 1 &&
    machine.compensation.preActivationCodes[0] === 'G60' &&
    machine.output.coordinatePrecision === 3 &&
    machine.output.lineEnding === 'crlf'
  );
}

function auditVerifiedRobofilProgram(input: {
  lines: string[];
  headerLineCount: number;
  structuredPrefix: string[];
  contourLineCount: number;
  expectedCompensation: 'G41' | 'G42';
  dIndex: number;
}) {
  const executable = input.lines.map(stripComments).filter(Boolean);
  if (
    executable.slice(0, input.structuredPrefix.length).join('\n') !==
    input.structuredPrefix.join('\n')
  ) {
    return 'The verified Robofil structured prologue is not the first executable sequence.';
  }
  if (input.contourLineCount === 0) return 'The verified Robofil program has no contour moves.';
  const firstContour = input.lines[input.headerLineCount + input.structuredPrefix.length];
  if (!/^G[123]\b/.test(firstContour)) {
    return 'The verified Robofil contour must begin directly with G1, G2, or G3.';
  }
  if (input.lines.some((line) => /^G0\b/.test(stripComments(line)))) {
    return 'The verified Robofil program contains an unsupported rapid block.';
  }
  const forbidden = /\b(?:G17|G21|G40|G54|M30)\b/;
  if (input.lines.some((line) => forbidden.test(stripComments(line)))) {
    return 'The verified Robofil program contains a profile-forbidden modal word.';
  }
  const expectedActivation = `${input.expectedCompensation} D${input.dIndex}`;
  const compensationLines = executable.filter((line) => /\bG4[12]\b/.test(line));
  if (compensationLines.length !== 1 || compensationLines[0] !== expectedActivation) {
    return 'The verified Robofil program does not contain exactly one derived compensation activation.';
  }
  if (
    executable.filter((line) => /\bM02\b/.test(line)).length !== 1 ||
    executable.at(-1) !== 'M02'
  ) {
    return 'The verified Robofil program must end with M02 only.';
  }
  return null;
}

export function machineResultFromGenericPost(posted: GcodePostResult): UpidMachinePostResult {
  return {
    ...posted,
    blocks:
      posted.status === 'ready'
        ? posted.moves.map((move) => ({
            bodyLineIndex: move.bodyLineIndex,
            kind:
              move.kind === 'rapid'
                ? 'rapid' as const
                : move.reason === 'manual-lead-in'
                  ? 'lead-in' as const
                  : 'contour' as const,
            text: move.text,
            operationId: move.operationId,
            segmentId: move.segmentId,
            startPoint: move.startPoint,
            endPoint: move.endPoint,
            command: move.command,
            compensationBefore: 'G40' as const,
            compensationAfter: 'G40' as const
          }))
        : [],
    programOwned: false
  };
}

function rebaseMoves(moves: GcodePostedMove[], offset: number) {
  return moves.map((move) => ({ ...move, bodyLineIndex: move.bodyLineIndex + offset }));
}

function rebaseOperations(
  operations: GcodePostedOperation[],
  offset: number,
  moves: GcodePostedMove[]
) {
  const movesByOperation = new Map<string, GcodePostedMove[]>();
  moves.forEach((move) => {
    if (!move.operationId) return;
    const operationMoves = movesByOperation.get(move.operationId) ?? [];
    operationMoves.push(move);
    movesByOperation.set(move.operationId, operationMoves);
  });
  return operations.map((operation) => ({
    ...operation,
    bodyLineStart: operation.bodyLineStart + offset,
    bodyLineEnd: operation.bodyLineEnd + offset,
    moves: movesByOperation.get(operation.operationId) ?? []
  }));
}

function effectiveDocumentEndpointTolerance(document: PathPlanningDocument) {
  return Math.max(
    document.options.endpointTolerance,
    document.options.coincidenceEpsilon,
    ...document.endpointClusters
      .filter((cluster) => cluster.method === 'within-tolerance')
      .map((cluster) => cluster.toleranceUsed)
  );
}

function templateLines(source: string) {
  const trimmed = source.trim();
  return trimmed ? trimmed.split(/\r?\n/) : [];
}

function verifiedRobofilStructuredPrefix(
  machine: MachineProfile,
  compensationCode: 'G41' | 'G42'
) {
  return [
    'G92 X0 Y0',
    ...machine.compensation.preActivationCodes,
    'G38',
    `${compensationCode} D${machine.compensation.offsetSelection.index}`,
    machine.controller.distanceMode
  ];
}

function stripComments(line: string) {
  return stripGcodeComments(line).trim().toUpperCase();
}

function machineArcCenterMode(machine: MachineProfile): 'absolute' | 'incremental' {
  if (machine.controller.coordinateSystem !== 'template-managed') {
    return machine.controller.arcCenterMode === 'absolute' ? 'absolute' : 'incremental';
  }

  const state = createGCodeInterpreterState();
  machine.templates.header.split(/\r?\n/).forEach((line, index) => {
    interpretGCodeBlock(state, line, index + 1);
  });
  return state.ijMode;
}

function blockedReason(
  reason: string,
  message: string,
  extraDetails: Record<string, unknown> = {}
) {
  return blockedMachinePost(
    [
      {
        id: 'diag_machine_post_0001',
        severity: 'error',
        code: 'post-invalid-input',
        message,
        details: { reason, ...extraDetails }
      }
    ],
    true
  );
}

function blockedMachinePost(
  diagnostics: PathDiagnostic[],
  programOwned: boolean
): UpidMachinePostResult {
  return {
    status: 'blocked',
    body: '',
    diagnostics: [...diagnostics],
    metrics: { rapidCount: 0, cutMoveCount: 0 },
    moves: [],
    operations: [],
    blocks: [],
    programOwned
  };
}
