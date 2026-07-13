import { validateCompensatedExport } from '@/domain/compensation/validateCompensatedExport';
import { resolveControllerCompensation } from '@/domain/compensation/resolveControllerCompensation';
import { machineProfileHasCurrentVerification } from '@/domain/machine/machineProfiles';
import {
  formatGcodePointWords,
  preflightPathPlanToGcode,
  postPathPlanToGcode,
  type GcodePostResult,
  type GcodePostedMove,
  type GcodePostedOperation
} from '@/domain/path-intel/postGcode';
import type { PathDiagnostic, PathPlanningDocument, Point2 } from '@/domain/path-intel/types';
import { validateUpidDocument } from '@/domain/upid/validateUpidDocument';
import type { MachineProfile } from '@/domain/workbench/types';

import {
  inferTemplateArcCenterMode,
  stripGcodeComments,
  validateTemplateModalPolicy
} from './templateModalPolicy';
import {
  matchesVerifiedRobofilPostEnvelope,
  verifiedRobofilPostEnvelopeIsReady
} from './verifiedRobofilPostEnvelope';

export { verifiedRobofilPostEnvelopeIsReady } from './verifiedRobofilPostEnvelope';

export type GcodePostedBlockKind =
  | 'template'
  | 'setup'
  | 'rapid'
  | 'compensation-activation'
  | 'lead-in'
  | 'lead-out'
  | 'contour'
  | 'compensation-cancellation'
  | 'operation-boundary'
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

export function deriveVerifiedRobofilPreviewPostBlocks(
  document: PathPlanningDocument,
  machine: MachineProfile
): VerifiedRobofilPreviewPostBlock[] | undefined {
  if (machine.controller.family !== 'charmilles-robofil-classic') return undefined;
  if (
    !verifiedRobofilPostEnvelopeIsReady(machine) ||
    document.plan.operations.length !== 1
  ) return [];
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
  const structuredCompensationRequested =
    Array.isArray(document?.plan?.operations) &&
    document.plan.operations.some(
      (operation) => operation?.compensationIntent?.mode === 'controller'
    );
  const validation = validateUpidDocument(document);
  if (!validation.valid) {
    return blockedMachinePost(
      validation.blockingDiagnostics,
      machine.controller.family === 'charmilles-robofil-classic' ||
        structuredCompensationRequested
    );
  }

  const compensatedOperations = document.plan.operations.filter(
    (operation) => operation.compensationIntent?.mode === 'controller'
  );
  if (
    machine.controller.family === 'charmilles-robofil-classic' &&
    compensatedOperations.length === 0
  ) {
    if (!machineProfileHasCurrentVerification(machine)) {
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

  if (machine.compensation.activation === 'linear-lead') {
    return postGenericExplicitLinear(document, machine, compensatedOperations);
  }

  if (machine.controller.family !== 'charmilles-robofil-classic') {
    return blockedReason('unsupported-compensation-lifecycle', 'The selected native compensation lifecycle is unsupported.');
  }

  return postVerifiedRobofil(document, machine, compensatedOperations);
}

function postGenericExplicitLinear(
  document: PathPlanningDocument,
  machine: MachineProfile,
  compensatedOperations: PathPlanningDocument['plan']['operations']
): UpidMachinePostResult {
  const readinessByOperationId = new Map<
    string,
    Extract<ReturnType<typeof validateCompensatedExport>, { status: 'ready' }>
  >();
  for (const operation of compensatedOperations) {
    const readiness = validateCompensatedExport({ document, operation, machine });
    if (readiness.status === 'blocked') return blockedMachinePost(readiness.diagnostics, true);
    if (readiness.strategy !== 'explicit-linear' || !readiness.transition) {
      return blockedReason('unsupported-compensation-lifecycle', 'The selected lifecycle is not explicit-linear.');
    }
    readinessByOperationId.set(operation.id, readiness);
  }

  const lines: string[] = [];
  const moves: GcodePostedMove[] = [];
  const operations: GcodePostedOperation[] = [];
  const blocks: GcodePostedBlock[] = [];
  const diagnostics: PathDiagnostic[] = [];
  let currentPosition: Point2 | null = null;

  const appendBoundary = (operationId: string) => {
    lines.push('G40');
    blocks.push({
      bodyLineIndex: lines.length - 1,
      kind: 'operation-boundary',
      text: 'G40',
      operationId,
      segmentId: null,
      startPoint: null,
      endPoint: null,
      command: null,
      compensationBefore: 'G40',
      compensationAfter: 'G40'
    });
  };

  const appendMove = (
    move: GcodePostedMove,
    kind: GcodePostedBlockKind,
    compensationBefore: 'G40' | 'G41' | 'G42' = 'G40',
    compensationAfter: 'G40' | 'G41' | 'G42' = compensationBefore
  ) => {
    const posted = { ...move, bodyLineIndex: lines.length };
    lines.push(posted.text);
    moves.push(posted);
    blocks.push({
      bodyLineIndex: posted.bodyLineIndex,
      kind,
      text: posted.text,
      operationId: posted.operationId,
      segmentId: posted.segmentId,
      startPoint: posted.startPoint,
      endPoint: posted.endPoint,
      command: posted.command,
      compensationBefore,
      compensationAfter
    });
    currentPosition = posted.endPoint;
    return posted;
  };

  for (const operation of document.plan.operations) {
    const operationLineStart = lines.length;
    const operationMoves: GcodePostedMove[] = [];
    appendBoundary(operation.id);
    const readiness = readinessByOperationId.get(operation.id);

    if (readiness) {
      const transition = readiness.transition!;
      const leadInWords = formatGcodePointWords(transition.leadIn.start, machine.output.coordinatePrecision);
      const leadOutWords = formatGcodePointWords(transition.leadOut.end, machine.output.coordinatePrecision);
      if (!leadInWords || !leadOutWords) {
        return blockedReason('post-formatting-failed', 'The generated compensation transition cannot be formatted.');
      }
      operationMoves.push(appendMove({
        bodyLineIndex: -1,
        command: 'G0',
        contourId: operation.contourId,
        endPoint: transition.leadIn.start,
        kind: 'rapid',
        operationId: operation.id,
        reason: 'operation-start',
        segmentId: null,
        startPoint: currentPosition,
        text: `G0 ${leadInWords}`
      }, 'rapid'));

      const derivedOperation = {
        ...operation,
        segmentRefs: transition.effectiveRefs.map((ref) => ({ ...ref })),
        startPoint: { ...transition.startPoint },
        endPoint: { ...transition.startPoint }
      };
      const geometry = postPathPlanToGcode(
        { ...document.plan, operations: [derivedOperation] },
        document.segments,
        {
          ...document.options,
          arcCenterMode: machineArcCenterMode(machine),
          coordinatePrecision: machine.output.coordinatePrecision,
          endpointTolerance: effectiveDocumentEndpointTolerance(document),
          coincidenceEpsilon: document.options.coincidenceEpsilon,
          initialPosition: transition.leadIn.start,
          operationStartMode: 'linear'
        }
      );
      if (geometry.status === 'blocked') return blockedMachinePost(geometry.diagnostics, true);
      diagnostics.push(...geometry.diagnostics);
      const approach = geometry.moves[0];
      if (!approach || approach.reason !== 'operation-start-approach') {
        return blockedReason('post-audit-failed', 'The explicit compensation lead-in was not rendered canonically.');
      }
      const code = readiness.resolution.code;
      geometry.moves.forEach((move, index) => {
        const posted = appendMove({
          ...move,
          bodyLineIndex: -1,
          text: index === 0
            ? `${code} D${machine.compensation.offsetSelection.index} ${move.text}`
            : move.text
        }, index === 0 ? 'lead-in' : 'contour', index === 0 ? 'G40' : code, code);
        operationMoves.push(posted);
      });
      operationMoves.push(appendMove({
        bodyLineIndex: -1,
        command: 'G1',
        contourId: operation.contourId,
        endPoint: transition.leadOut.end,
        kind: 'cut',
        operationId: operation.id,
        reason: 'compensation-lead-out',
        segmentId: null,
        startPoint: transition.leadOut.start,
        text: `G40 G1 ${leadOutWords}`
      }, 'lead-out', code, 'G40'));
    } else {
      const geometry = postPathPlanToGcode(
        { ...document.plan, operations: [operation] },
        document.segments,
        {
          ...document.options,
          arcCenterMode: machineArcCenterMode(machine),
          coordinatePrecision: machine.output.coordinatePrecision,
          endpointTolerance: effectiveDocumentEndpointTolerance(document),
          coincidenceEpsilon: document.options.coincidenceEpsilon,
          ...(currentPosition ? { initialPosition: currentPosition } : {})
        }
      );
      if (geometry.status === 'blocked') return blockedMachinePost(geometry.diagnostics, true);
      diagnostics.push(...geometry.diagnostics);
      geometry.moves.forEach((move) => {
        operationMoves.push(appendMove(
          { ...move, bodyLineIndex: -1 },
          move.kind === 'rapid'
            ? 'rapid'
            : move.reason === 'manual-lead-in'
              ? 'lead-in'
              : 'contour'
        ));
      });
    }

    operations.push({
      bodyLineStart: operationLineStart,
      bodyLineEnd: lines.length - 1,
      classification: operation.classification,
      closed: operation.closed,
      contourId: operation.contourId,
      cutMoveCount: operationMoves.filter((move) => move.kind === 'cut').length,
      direction: operation.direction,
      displayName: operation.displayName,
      moves: operationMoves,
      operationId: operation.id,
      orderIndex: operation.orderIndex,
      rapidCount: operationMoves.filter((move) => move.kind === 'rapid').length
    });
  }

  const result: UpidMachinePostResult = {
    status: 'ready',
    body: lines.join('\n'),
    diagnostics,
    metrics: {
      rapidCount: moves.filter((move) => move.kind === 'rapid').length,
      cutMoveCount: moves.filter((move) => move.kind === 'cut').length
    },
    moves,
    operations,
    blocks,
    programOwned: false
  };
  const auditIssue = auditGenericExplicitLinearPost(result);
  return auditIssue
    ? blockedReason('post-audit-failed', auditIssue)
    : result;
}

export function auditGenericExplicitLinearPost(
  result: Pick<
    UpidMachinePostResult,
    'body' | 'blocks' | 'moves' | 'operations' | 'metrics'
  >
) {
  const lines = result.body ? result.body.split('\n') : [];
  if (lines.length !== result.blocks.length) {
    return 'The generic structured block count does not match the executable body.';
  }

  let compensation: 'G40' | 'G41' | 'G42' = 'G40';
  for (const [index, block] of result.blocks.entries()) {
    if (block.bodyLineIndex !== index || block.text !== lines[index]) {
      return 'The generic structured block line map is not contiguous.';
    }
    if (
      block.kind === 'rapid' &&
      (block.compensationBefore !== 'G40' || block.compensationAfter !== 'G40')
    ) {
      return 'The generic post contains a rapid while controller compensation is active.';
    }
    if (block.compensationBefore !== compensation) {
      return 'The generic structured blocks contain a discontinuous compensation modal state.';
    }
    if (
      block.kind === 'operation-boundary' &&
      (block.compensationBefore !== 'G40' || block.compensationAfter !== 'G40')
    ) {
      return 'A generic operation boundary is not in G40.';
    }
    if (
      block.kind === 'lead-in' &&
      (block.compensationBefore !== 'G40' || block.compensationAfter !== 'G40') &&
      (
        block.compensationBefore !== 'G40' ||
        block.compensationAfter === 'G40' ||
        !/^G4[12] D\d+ G1\b/.test(block.text)
      )
    ) {
      return 'The generic compensation activation lead-in is malformed.';
    }
    if (
      block.kind === 'lead-out' &&
      (
        block.compensationBefore === 'G40' ||
        block.compensationAfter !== 'G40' ||
        !/^G40 G1\b/.test(block.text)
      )
    ) {
      return 'The generic compensation cancellation lead-out is malformed.';
    }
    compensation = block.compensationAfter;
  }
  if (compensation !== 'G40') {
    return 'The generic post ends with controller compensation active.';
  }

  const motionBlocks = result.blocks.filter((block) => block.command !== null);
  if (
    motionBlocks.length !== result.moves.length ||
    motionBlocks.some((block, index) => {
      const move = result.moves[index];
      return !move ||
        move.bodyLineIndex !== block.bodyLineIndex ||
        move.text !== block.text ||
        move.command !== block.command;
    })
  ) {
    return 'The generic motion trace is inconsistent with its structured blocks.';
  }
  const rapidCount = result.moves.filter((move) => move.kind === 'rapid').length;
  const cutMoveCount = result.moves.filter((move) => move.kind === 'cut').length;
  if (
    result.metrics.rapidCount !== rapidCount ||
    result.metrics.cutMoveCount !== cutMoveCount
  ) {
    return 'The generic post metrics are inconsistent with its motion trace.';
  }

  for (const operation of result.operations) {
    const startBlock = result.blocks[operation.bodyLineStart];
    const endBlock = result.blocks[operation.bodyLineEnd];
    const expectedMoves = result.moves.filter((move) => move.operationId === operation.operationId);
    if (
      startBlock?.kind !== 'operation-boundary' ||
      startBlock.operationId !== operation.operationId ||
      endBlock?.operationId !== operation.operationId ||
      operation.moves.length !== expectedMoves.length ||
      operation.moves.some((move, index) => move.bodyLineIndex !== expectedMoves[index]?.bodyLineIndex) ||
      operation.rapidCount !== expectedMoves.filter((move) => move.kind === 'rapid').length ||
      operation.cutMoveCount !== expectedMoves.filter((move) => move.kind === 'cut').length
    ) {
      return 'A generic operation range or motion trace is inconsistent.';
    }
  }
  return null;
}

function postVerifiedRobofil(
  document: PathPlanningDocument,
  machine: MachineProfile,
  compensatedOperations: PathPlanningDocument['plan']['operations']
): UpidMachinePostResult {
  if (!machineProfileHasCurrentVerification(machine)) {
    return blockedReason(
      'unverified-machine-profile',
      'Robofil compensated posting requires a current user-verified project machine snapshot.'
    );
  }
  if (!matchesVerifiedRobofilPostEnvelope(machine)) {
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

  return inferTemplateArcCenterMode(machine.templates.header);
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
