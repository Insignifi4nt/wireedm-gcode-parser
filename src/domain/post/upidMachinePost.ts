import {
  validateCompensatedExport,
  type CompensatedExportReadiness
} from '@/domain/compensation/validateCompensatedExport';
import { resolveControllerCompensation } from '@/domain/compensation/resolveControllerCompensation';
import { machineProfileHasCurrentVerification } from '@/domain/machine/machineProfiles';
import {
  formatGcodePointWords,
  postPathPlanToGcode,
  type GcodePostResult,
  type GcodePostedMove,
  type GcodePostedOperation
} from '@/domain/path-intel/postGcode';
import { resolveInitialWirePosition } from '@/domain/path-intel/initialWirePosition';
import {
  readOperationTransitions,
  operationEntryPoint
} from '@/domain/path-intel/operationTransitions';
import { deriveActiveMachiningOperations } from '@/domain/path-intel/machiningParticipation';
import { orderedPathOperations } from '@/domain/path-intel/operationExecutionOrder';
import { resolveOperationTransitionOwnership } from '@/domain/path-intel/operationTransitionOwnership';
import { resolveOperationThreadingTransition } from '@/domain/path-intel/threadingTransitions';
import {
  resolveProgramStopPoints,
  validateProgramStops,
  type ProgramStopValidation
} from '@/domain/path-intel/programStops';
import type { PathDiagnostic, PathPlanningDocument, Point2 } from '@/domain/path-intel/types';
import { validateUpidDocument } from '@/domain/upid/validateUpidDocument';
import type { MachineProfile } from '@/domain/workbench/types';

import {
  inferTemplateArcCenterMode,
  stripGcodeComments,
  validateTemplateModalPolicy
} from './templateModalPolicy';
import {
  matchesRobofilV2PostEnvelope,
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
  | 'wire-separation'
  | 'position-for-threading'
  | 'manual-rethread'
  | 'automatic-rethread'
  | 'program-stop'
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

export interface UpidMachinePostPreparationIssue {
  reason: string;
  scope:
    | 'program'
    | 'machine-setup'
    | 'geometry-setup'
    | 'initial-wire'
    | 'machining-participation'
    | 'entry-exit'
    | 'contour-start'
    | 'cut-path'
    | 'program-stop';
  effectiveOperationId?: string;
  sourceOperationId?: string;
  programStopReason?: Extract<
    ProgramStopValidation,
    { status: 'blocked' }
  >['reason'];
}

type ReadyMachiningDerivation = Extract<
  ReturnType<typeof deriveActiveMachiningOperations>,
  { status: 'ready' }
>;

interface ReadyUpidMachinePostPreparationBase {
  status: 'ready';
  document: PathPlanningDocument;
  machining: ReadyMachiningDerivation;
  issues: UpidMachinePostPreparationIssue[];
  programOwned: boolean;
}

export type ReadyUpidMachinePostPreparation =
  | (ReadyUpidMachinePostPreparationBase & {
      route: 'generic';
    })
  | (ReadyUpidMachinePostPreparationBase & {
      route: 'explicit-linear';
      readinessByOperationId: Map<
        string,
        Extract<ReturnType<typeof validateCompensatedExport>, { status: 'ready' }>
      >;
    })
  | (ReadyUpidMachinePostPreparationBase & {
      route: 'robofil-v1';
      compensationCode: 'G41' | 'G42';
      initialWirePoint: Point2;
      initialWireWords: string;
    })
  | (ReadyUpidMachinePostPreparationBase & {
      route: 'robofil-v2';
      initialWirePoint: Point2;
      initialWireWords: string;
      resolutionByOperationId: Map<string, 'G41' | 'G42'>;
      programStopsByOperationId: Map<string, ProgramStopValidation>;
    });

export type UpidMachinePostPreparation =
  | ReadyUpidMachinePostPreparation
  | {
      status: 'blocked';
      result: UpidMachinePostResult;
      reason?: string;
      document?: PathPlanningDocument;
      machining?: ReturnType<typeof deriveActiveMachiningOperations>;
      issues: UpidMachinePostPreparationIssue[];
    };

export type VerifiedRobofilPreviewPostBlock = Pick<
  GcodePostedBlock,
  'bodyLineIndex' | 'kind' | 'operationId' | 'startPoint' | 'endPoint'
>;

export interface UpidPreviewPostProjection {
  authoritativeGeneratedOperationIds: readonly string[];
  blocks: VerifiedRobofilPreviewPostBlock[];
}

export function deriveUpidPreviewPostProjection(
  document: PathPlanningDocument,
  machine: MachineProfile
): UpidPreviewPostProjection | undefined {
  const robofilOwned =
    machine.controller.family === 'charmilles-robofil-classic';
  const hasGeneratedTransitionOwnership = document.plan.operations.some(
    (operation) =>
      resolveOperationTransitionOwnership(operation, machine) ===
      'generated-explicit-linear'
  );
  if (!robofilOwned && !hasGeneratedTransitionOwnership) return undefined;

  const preparation = prepareUpidMachinePost(document, machine);
  if (preparation.status === 'blocked') {
    return {
      authoritativeGeneratedOperationIds: generatedOwnedOperationIds(
        preparation.machining?.status === 'ready'
          ? preparation.machining.operations
          : document.plan.operations,
        machine
      ),
      blocks: []
    };
  }
  const authoritativeGeneratedOperationIds =
    preparation.route === 'explicit-linear'
      ? [...preparation.readinessByOperationId.keys()]
      : [];
  const posted = postUpidForMachine(document, machine);
  if (posted.status === 'blocked') {
    return {
      authoritativeGeneratedOperationIds,
      blocks: []
    };
  }

  return {
    authoritativeGeneratedOperationIds,
    blocks: previewPostBlocks(posted.blocks)
  };
}

export function deriveVerifiedRobofilPreviewPostBlocks(
  document: PathPlanningDocument,
  machine: MachineProfile
): VerifiedRobofilPreviewPostBlock[] | undefined {
  if (machine.controller.family !== 'charmilles-robofil-classic') return undefined;
  return deriveUpidPreviewPostProjection(document, machine)?.blocks ?? [];
}

function previewPostBlocks(
  blocks: readonly GcodePostedBlock[]
): VerifiedRobofilPreviewPostBlock[] {
  return blocks.flatMap((block) =>
    (
      block.kind === 'rapid' ||
      block.kind === 'position-for-threading' ||
      block.kind === 'lead-in' ||
      block.kind === 'lead-out'
    ) &&
    block.operationId &&
    block.startPoint &&
    block.endPoint
      ? [{
          bodyLineIndex: block.bodyLineIndex,
          kind: block.kind,
          operationId: block.operationId,
          startPoint: block.startPoint,
          endPoint: block.endPoint
        }]
      : []
  );
}

function generatedOwnedOperationIds(
  operations: readonly PathPlanningDocument['plan']['operations'][number][],
  machine: MachineProfile
): string[] {
  return operations.flatMap((operation) =>
    resolveOperationTransitionOwnership(operation, machine) ===
    'generated-explicit-linear'
      ? [operation.id]
      : []
  );
}

export function postUpidForMachine(
  sourceDocument: PathPlanningDocument,
  machine: MachineProfile,
  _options: UpidMachinePostOptions = {}
): UpidMachinePostResult {
  const preparation = prepareUpidMachinePost(sourceDocument, machine);
  if (preparation.status === 'blocked') return preparation.result;

  if (preparation.route === 'generic') {
    const posted = postPathPlanToGcode(
      preparation.document.plan,
      preparation.document.segments,
      genericPostOptions(preparation.document, machine)
    );
    return machineResultFromGenericPost(posted);
  }
  if (preparation.route === 'explicit-linear') {
    return postGenericExplicitLinear(
      preparation.document,
      machine,
      preparation.readinessByOperationId
    );
  }
  if (preparation.route === 'robofil-v2') {
    return postRobofilV2(preparation.document, machine, preparation);
  }
  return postVerifiedRobofil(preparation.document, machine, preparation);
}

export function prepareUpidMachinePost(
  sourceDocument: PathPlanningDocument,
  machine: MachineProfile
): UpidMachinePostPreparation {
  const structuredCompensationRequested =
    Array.isArray(sourceDocument?.plan?.operations) &&
    sourceDocument.plan.operations.some(
      (operation) => operation?.compensationIntent?.mode === 'controller'
    );
  const validation = validateUpidDocument(sourceDocument);
  if (!validation.valid) {
    return blockedPreparation(blockedMachinePost(
      validation.blockingDiagnostics,
      machine.controller.family === 'charmilles-robofil-classic' ||
      structuredCompensationRequested
    ));
  }

  const machining = deriveActiveMachiningOperations(sourceDocument);
  if (machining.status === 'blocked') {
    return blockedPreparation(blockedReason(
      'machining-participation-blocked',
      `Machining participation could not be resolved: ${machining.reason}.`,
      { machiningParticipationReason: machining.reason }
    ), {
      reason: 'machining-participation-blocked',
      machining
    });
  }
  if (machining.operations.length === 0) {
    return blockedPreparation(blockedReason(
      'machining-participation-blocked',
      'Machining participation leaves no active cutting operations.'
    ), {
      reason: 'machining-participation-blocked',
      machining
    });
  }
  const document = effectiveMachiningDocument(sourceDocument, machining);
  const partialOperationsMissingControllerSide =
    document.plan.operations.filter((operation) => {
      if (
        operation.machiningIntent?.kind !== 'partial-contour' ||
        operation.compensationIntent?.mode === 'controller'
      ) {
        return false;
      }
      return sourceDocument.plan.operations.some(
        (sourceOperation) =>
          sourceOperation.id === operation.machiningIntent?.sourceOperationId &&
          sourceOperation.compensationIntent?.mode === 'controller'
      );
    });
  if (partialOperationsMissingControllerSide.length > 0) {
    const reason = 'partial-controller-side-required';
    return blockedPreparation(blockedReason(
      reason,
      'Partial machining requires an explicit controller side before compensated posting.'
    ), {
      reason,
      document,
      machining,
      issues: partialOperationsMissingControllerSide.map(
        (operation) =>
          operationIssue(operation, reason, 'machining-participation')
      )
    });
  }
  const enabledProgramStops = document.plan.operations.flatMap((operation) =>
    (operation.programStops ?? []).filter((stop) => stop.enabled)
  );
  const postOwnsProgramStops =
    machine.controller.family === 'charmilles-robofil-classic' &&
    machine.controller.postVersion === 2 &&
    machine.compensation.activation === 'charmilles-g38';
  if (enabledProgramStops.length > 0 && !postOwnsProgramStops) {
    const issues = document.plan.operations.flatMap((operation) =>
      (operation.programStops ?? []).some((stop) => stop.enabled)
        ? [operationIssue(operation, 'program-stop-post-unsupported')]
        : []
    );
    return blockedPreparation(blockedReason(
      'program-stop-post-unsupported',
      'The selected post cannot emit configured program stops; export is blocked rather than dropping M00 intent.'
    ), {
      reason: 'program-stop-post-unsupported',
      document,
      machining,
      issues
    });
  }

  const compensatedOperations = document.plan.operations.filter(
    (operation) => operation.compensationIntent?.mode === 'controller'
  );
  if (
    machine.controller.family === 'charmilles-robofil-classic' &&
    compensatedOperations.length === 0
  ) {
    if (!machineProfileHasCurrentVerification(machine)) {
      return blockedPreparation(blockedReason(
        'unverified-machine-profile',
        'Robofil compensated posting requires a current user-verified project machine snapshot.'
      ), {
        reason: 'unverified-machine-profile',
        document,
        machining,
        issues: [globalPreparationIssue('unverified-machine-profile')]
      });
    }
    const reason = document.geometryBasis === 'wire-centre' ? 'wire-centre' : 'missing-intent';
    return blockedPreparation(blockedReason(
      'compensation-resolution-blocked',
      `Controller compensation could not be resolved: ${reason}.`,
      { compensationReason: reason }
    ), {
      reason: 'compensation-resolution-blocked',
      document,
      machining,
      issues: [
        globalPreparationIssue(
          'compensation-resolution-blocked',
          'geometry-setup'
        )
      ]
    });
  }
  if (compensatedOperations.length === 0) {
    return {
      status: 'ready',
      route: 'generic',
      document,
      machining,
      issues: [],
      programOwned: false
    };
  }

  if (machine.compensation.activation === 'linear-lead') {
    const readinessByOperationId = new Map<
      string,
      Extract<ReturnType<typeof validateCompensatedExport>, { status: 'ready' }>
    >();
    for (const operation of compensatedOperations) {
      const readiness = validateCompensatedExport({ document, operation, machine });
      if (readiness.status === 'blocked') {
        return blockedPreparation(blockedMachinePost(readiness.diagnostics, true), {
          reason: readiness.reason,
          document,
          machining,
          issues: preparationIssues(
            readiness.reason,
            [operation],
            readiness.failureOwner
          )
        });
      }
      if (readiness.strategy !== 'explicit-linear' || !readiness.transition) {
        return blockedPreparation(blockedReason(
          'unsupported-compensation-lifecycle',
          'The selected lifecycle is not explicit-linear.'
        ), {
          reason: 'unsupported-compensation-lifecycle',
          document,
          machining,
          issues: preparationIssues(
            'unsupported-compensation-lifecycle',
            [operation]
          )
        });
      }
      readinessByOperationId.set(operation.id, readiness);
    }
    return {
      status: 'ready',
      route: 'explicit-linear',
      document,
      machining,
      readinessByOperationId,
      issues: [],
      programOwned: true
    };
  }

  if (machine.controller.family !== 'charmilles-robofil-classic') {
    return blockedPreparation(
      blockedReason(
        'unsupported-compensation-lifecycle',
        'The selected native compensation lifecycle is unsupported.'
      ),
      {
        reason: 'unsupported-compensation-lifecycle',
        document,
        machining,
        issues: preparationIssues(
          'unsupported-compensation-lifecycle',
          compensatedOperations
        )
      }
    );
  }

  if (machine.controller.postVersion === 2) {
    return prepareRobofilV2(document, machine, machining, compensatedOperations);
  }

  return prepareVerifiedRobofil(document, machine, machining, compensatedOperations);
}

function effectiveMachiningDocument(
  source: PathPlanningDocument,
  machining: Extract<ReturnType<typeof deriveActiveMachiningOperations>, { status: 'ready' }>
): PathPlanningDocument {
  const operations = structuredClone(orderedPathOperations(machining.operations));
  return {
    ...structuredClone(source),
    segments: structuredClone(machining.segments),
    plan: {
      ...structuredClone(source.plan),
      operations,
      metrics: {
        operationCount: operations.length,
        totalCutLength: operations.reduce(
          (total, operation) => total + operation.metrics.cutLength,
          0
        ),
        totalRapidLength: operations.reduce(
          (total, operation) => total + operation.metrics.rapidInLength,
          0
        )
      }
    }
  };
}

function genericPostOptions(
  document: PathPlanningDocument,
  machine: MachineProfile
) {
  return {
    ...document.options,
    arcCenterMode: machineArcCenterMode(machine),
    coordinatePrecision: machine.output.coordinatePrecision,
    endpointTolerance: effectiveDocumentEndpointTolerance(document),
    coincidenceEpsilon: document.options.coincidenceEpsilon
  };
}

function postGenericExplicitLinear(
  document: PathPlanningDocument,
  machine: MachineProfile,
  readinessByOperationId: Map<
    string,
    Extract<ReturnType<typeof validateCompensatedExport>, { status: 'ready' }>
  >
): UpidMachinePostResult {
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
        endPoint: { ...transition.startPoint },
        transitions: undefined
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
  const auditIssue = auditGenericExplicitLinearPost(
    result,
    [...readinessByOperationId].map(([operationId, readiness]) => ({
      operationId,
      code: readiness.resolution.code,
      dIndex: machine.compensation.offsetSelection.index
    }))
  );
  return auditIssue
    ? blockedReason('post-audit-failed', auditIssue)
    : result;
}

export interface GenericExplicitLinearLifecycleExpectation {
  operationId: string;
  code: 'G41' | 'G42';
  dIndex: number;
}

export function auditGenericExplicitLinearPost(
  result: Pick<
    UpidMachinePostResult,
    'body' | 'blocks' | 'moves' | 'operations' | 'metrics'
  >,
  expectedLifecycles: GenericExplicitLinearLifecycleExpectation[]
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

  const expectedByOperationId = new Map(
    expectedLifecycles.map((expected) => [expected.operationId, expected])
  );
  if (expectedByOperationId.size !== expectedLifecycles.length) {
    return 'The generic post audit received duplicate lifecycle expectations.';
  }
  for (const expected of expectedLifecycles) {
    const operationBlocks = result.blocks.filter(
      (block) => block.operationId === expected.operationId
    );
    const activations = operationBlocks.filter(
      (block) => block.kind === 'lead-in' && block.compensationAfter !== 'G40'
    );
    const cancellations = operationBlocks.filter(
      (block) => block.kind === 'lead-out' && block.compensationBefore !== 'G40'
    );
    if (
      activations.length !== 1 ||
      activations[0].compensationBefore !== 'G40' ||
      activations[0].compensationAfter !== expected.code ||
      !activations[0].text.startsWith(`${expected.code} D${expected.dIndex} G1 `)
    ) {
      return `Operation ${expected.operationId} must activate exactly once with ${expected.code} D${expected.dIndex}.`;
    }
    if (
      cancellations.length !== 1 ||
      cancellations[0].compensationBefore !== expected.code ||
      cancellations[0].compensationAfter !== 'G40'
    ) {
      return `Operation ${expected.operationId} must cancel ${expected.code} exactly once with its lead-out.`;
    }
  }
  if (
    result.blocks.some(
      (block) =>
        (block.compensationBefore !== 'G40' || block.compensationAfter !== 'G40') &&
        (!block.operationId || !expectedByOperationId.has(block.operationId))
    )
  ) {
    return 'The generic post contains an unexpected compensated operation lifecycle.';
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

function prepareVerifiedRobofil(
  document: PathPlanningDocument,
  machine: MachineProfile,
  machining: ReadyMachiningDerivation,
  compensatedOperations: PathPlanningDocument['plan']['operations']
): UpidMachinePostPreparation {
  const blockedForOperations = (
    reason: string,
    result: UpidMachinePostResult,
    operations = compensatedOperations
  ) => blockedPreparation(result, {
    reason,
    document,
    machining,
    issues: preparationIssues(reason, operations)
  });

  if (!machineProfileHasCurrentVerification(machine)) {
    return blockedForOperations(
      'unverified-machine-profile',
      blockedReason(
        'unverified-machine-profile',
        'Robofil compensated posting requires a current user-verified project machine snapshot.'
      )
    );
  }
  if (!matchesVerifiedRobofilPostEnvelope(machine)) {
    return blockedForOperations(
      'unsupported-robofil-post-envelope',
      blockedReason(
        'unsupported-robofil-post-envelope',
        'This Robofil snapshot is outside the physically verified post-version-1 envelope.'
      )
    );
  }
  if (document.plan.operations.length !== 1 || compensatedOperations.length !== 1) {
    return blockedForOperations(
      'unsupported-operation-count',
      blockedReason(
        'unsupported-operation-count',
        'The verified program-scoped Robofil lifecycle supports exactly one compensated operation.'
      ),
      document.plan.operations
    );
  }

  const templatePolicy = validateTemplateModalPolicy({
    machine,
    header: machine.templates.header,
    footer: machine.templates.footer
  });
  if (!templatePolicy.valid) {
    return blockedForOperations(
      'template-modal-conflict',
      blockedReason(
        'template-modal-conflict',
        templatePolicy.diagnostics.map((diagnostic) => diagnostic.message).join(' '),
        { templateDiagnostics: templatePolicy.diagnostics }
      )
    );
  }

  const operation = compensatedOperations[0];
  const resolution = resolveControllerCompensation({ document, operation });
  if (resolution.status === 'blocked') {
    return blockedForOperations(
      'compensation-resolution-blocked',
      blockedReason(
        'compensation-resolution-blocked',
        `Controller compensation could not be resolved: ${resolution.reason}.`,
        { compensationReason: resolution.reason }
      )
    );
  }
  if (readOperationTransitions(operation).entry?.strategy === 'circle-center') {
    return blockedForOperations(
      'unsafe-controller-compensation-lead-in',
      blockedReason(
        'unsafe-controller-compensation-lead-in',
        'A radial circle-center lead-in is unsafe while Robofil controller compensation is active.'
      )
    );
  }
  const initialWire = resolveInitialWirePosition(document);
  if (initialWire.status === 'blocked') {
    return blockedForOperations(
      'initial-wire-position-required',
      blockedReason(
        'initial-wire-position-required',
        'Review Initial Wire Position before exporting with the verified Robofil post.',
        { initialWireReason: initialWire.reason }
      )
    );
  }
  const initialWireWords = formatGcodePointWords(
    initialWire.point,
    machine.output.coordinatePrecision
  );
  if (!initialWireWords) {
    return blockedForOperations(
      'initial-wire-position-required',
      blockedReason(
        'initial-wire-position-required',
        'Initial Wire Position could not be formatted for the selected machine.'
      )
    );
  }

  return {
    status: 'ready',
    route: 'robofil-v1',
    document,
    machining,
    compensationCode: resolution.code,
    initialWirePoint: { ...initialWire.point },
    initialWireWords,
    issues: [],
    programOwned: true
  };
}

function postVerifiedRobofil(
  document: PathPlanningDocument,
  machine: MachineProfile,
  preparation: Extract<ReadyUpidMachinePostPreparation, { route: 'robofil-v1' }>
): UpidMachinePostResult {
  const operation = document.plan.operations[0];
  const g92Words = preparation.initialWireWords;

  const geometry = postPathPlanToGcode(document.plan, document.segments, {
    ...document.options,
    arcCenterMode:
      machine.controller.arcCenterMode === 'absolute' ? 'absolute' : 'incremental',
    coordinatePrecision: machine.output.coordinatePrecision,
    endpointTolerance: effectiveDocumentEndpointTolerance(document),
    coincidenceEpsilon: document.options.coincidenceEpsilon,
    initialPosition: preparation.initialWirePoint,
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
  const structuredPrefix = verifiedRobofilStructuredPrefix(
    machine,
    preparation.compensationCode,
    g92Words
  );
  const prefixLines = [...headerLines, ...structuredPrefix];
  const contourLines = geometry.body ? geometry.body.split('\n') : [];
  const lines = [...prefixLines, ...contourLines, ...footerLines, 'M02'];

  const auditIssue = auditVerifiedRobofilProgram({
    lines,
    headerLineCount: headerLines.length,
    structuredPrefix,
    contourLineCount: contourLines.length,
    expectedCompensation: preparation.compensationCode,
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
      text === preparation.compensationCode ||
      text.startsWith(`${preparation.compensationCode} `)
        ? preparation.compensationCode
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
  appendModalBlock(`G92 ${g92Words}`, 'setup');
  machine.compensation.preActivationCodes.forEach((line) => appendModalBlock(line, 'setup'));
  appendModalBlock('G38', 'compensation-activation', operation.id);
  appendModalBlock(
    `${preparation.compensationCode} D${dIndex}`,
    'compensation-activation',
    operation.id
  );
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

function prepareRobofilV2(
  document: PathPlanningDocument,
  machine: MachineProfile,
  machining: ReadyMachiningDerivation,
  compensatedOperations: PathPlanningDocument['plan']['operations']
): UpidMachinePostPreparation {
  const blockedForOperations = (
    reason: string,
    result: UpidMachinePostResult,
    operations = compensatedOperations
  ) => blockedPreparation(result, {
    reason,
    document,
    machining,
    issues: preparationIssues(reason, operations)
  });

  if (!machineProfileHasCurrentVerification(machine)) {
    return blockedForOperations(
      'unverified-machine-profile',
      blockedReason(
        'unverified-machine-profile',
        'Robofil v2 compensated posting requires a current user-verified project machine snapshot.'
      )
    );
  }
  if (!matchesRobofilV2PostEnvelope(machine)) {
    return blockedForOperations(
      'unsupported-robofil-post-envelope',
      blockedReason(
        'unsupported-robofil-post-envelope',
        'This Robofil snapshot is outside the operation-scoped post-version-2 envelope.'
      )
    );
  }
  if (
    document.plan.operations.length === 0 ||
    compensatedOperations.length !== document.plan.operations.length
  ) {
    return blockedForOperations(
      'unsupported-operation-count',
      blockedReason(
        'unsupported-operation-count',
        'Robofil v2 requires every posted operation to have a resolved controller-compensation intent.'
      ),
      document.plan.operations
    );
  }

  const initialWire = resolveInitialWirePosition(document);
  if (initialWire.status === 'blocked') {
    return blockedForOperations(
      'initial-wire-position-required',
      blockedReason(
        'initial-wire-position-required',
        'Review Initial Wire Position before exporting with Robofil v2.',
        { initialWireReason: initialWire.reason }
      )
    );
  }
  const initialWireWords = formatGcodePointWords(
    initialWire.point,
    machine.output.coordinatePrecision
  );
  if (!initialWireWords) {
    return blockedForOperations(
      'initial-wire-position-required',
      blockedReason(
        'initial-wire-position-required',
        'Initial Wire Position could not be formatted for the selected machine.'
      )
    );
  }

  const templatePolicy = validateTemplateModalPolicy({
    machine,
    header: machine.templates.header,
    footer: machine.templates.footer
  });
  if (!templatePolicy.valid) {
    return blockedForOperations(
      'template-modal-conflict',
      blockedReason(
        'template-modal-conflict',
        templatePolicy.diagnostics.map((diagnostic) => diagnostic.message).join(' '),
        { templateDiagnostics: templatePolicy.diagnostics }
      )
    );
  }

  const resolutionByOperationId = new Map<string, 'G41' | 'G42'>();
  for (const operation of document.plan.operations) {
    const readiness = validateCompensatedExport({ document, operation, machine });
    if (readiness.status === 'blocked') {
      return blockedPreparation(blockedMachinePost(readiness.diagnostics, true), {
        reason: readiness.reason,
        document,
        machining,
        issues: preparationIssues(
          readiness.reason,
          [operation],
          readiness.failureOwner
        )
      });
    }
    resolutionByOperationId.set(operation.id, readiness.resolution.code);
  }

  const programStopsByOperationId = new Map<string, ProgramStopValidation>();
  const issues: UpidMachinePostPreparationIssue[] = [];
  for (const operation of document.plan.operations) {
    const validation = validateProgramStops(operation, machine, document.segments);
    programStopsByOperationId.set(operation.id, validation);
    if (validation.status === 'blocked') {
      issues.push({
        ...operationIssue(operation, 'program-stop-blocked'),
        programStopReason: validation.reason
      });
    }
  }

  return {
    status: 'ready',
    route: 'robofil-v2',
    document,
    machining,
    initialWirePoint: { ...initialWire.point },
    initialWireWords,
    resolutionByOperationId,
    programStopsByOperationId,
    issues,
    programOwned: true
  };
}

function postRobofilV2(
  document: PathPlanningDocument,
  machine: MachineProfile,
  preparation: Extract<ReadyUpidMachinePostPreparation, { route: 'robofil-v2' }>
): UpidMachinePostResult {
  const geometry = postPathPlanToGcode(document.plan, document.segments, {
    ...document.options,
    arcCenterMode:
      machine.controller.arcCenterMode === 'absolute' ? 'absolute' : 'incremental',
    coordinatePrecision: machine.output.coordinatePrecision,
    endpointTolerance: effectiveDocumentEndpointTolerance(document),
    coincidenceEpsilon: document.options.coincidenceEpsilon,
    initialPosition: preparation.initialWirePoint,
    operationStartMode: 'rapid'
  });
  if (geometry.status === 'blocked') return blockedMachinePost(geometry.diagnostics, true);

  const lines: string[] = [];
  const blocks: GcodePostedBlock[] = [];
  const moves: GcodePostedMove[] = [];
  const operations: GcodePostedOperation[] = [];
  let compensation: 'G40' | 'G41' | 'G42' = 'G40';
  let currentPosition: Point2 = { ...preparation.initialWirePoint };

  const appendModal = (
    text: string,
    kind: GcodePostedBlockKind,
    operationId: string | null = null
  ) => {
    const before = compensation;
    if (text === 'G40') compensation = 'G40';
    else if (/^G41(?:\s|$)/.test(text)) compensation = 'G41';
    else if (/^G42(?:\s|$)/.test(text)) compensation = 'G42';
    lines.push(text);
    blocks.push({
      bodyLineIndex: lines.length - 1,
      kind,
      text,
      operationId,
      segmentId: null,
      startPoint: null,
      endPoint: null,
      command: null,
      compensationBefore: before,
      compensationAfter: compensation
    });
  };
  const appendMove = (
    move: GcodePostedMove,
    kind?: GcodePostedBlockKind
  ) => {
    const postedMove = { ...move, bodyLineIndex: lines.length };
    lines.push(postedMove.text);
    moves.push(postedMove);
    blocks.push({
      bodyLineIndex: postedMove.bodyLineIndex,
      kind: kind ?? (
        postedMove.kind === 'rapid'
          ? 'rapid'
          : postedMove.reason === 'manual-lead-in' ||
              postedMove.reason === 'operation-start-approach'
            ? 'lead-in'
            : 'contour'
      ),
      text: postedMove.text,
      operationId: postedMove.operationId,
      segmentId: postedMove.segmentId,
      startPoint: postedMove.startPoint,
      endPoint: postedMove.endPoint,
      command: postedMove.command,
      compensationBefore: compensation,
      compensationAfter: compensation
    });
    return postedMove;
  };

  templateLines(machine.templates.header).forEach((line) => appendModal(line, 'template'));
  appendModal(`G92 ${preparation.initialWireWords}`, 'setup');
  machine.compensation.preActivationCodes.forEach((line) => appendModal(line, 'setup'));
  appendModal('G38', 'compensation-activation');
  appendModal(machine.controller.distanceMode, 'setup');

  for (const [operationIndex, operation] of document.plan.operations.entries()) {
    const geometryOperation = geometry.operations.find(
      (candidate) => candidate.operationId === operation.id
    );
    if (!geometryOperation) {
      return blockedReason(
        'post-audit-failed',
        `Robofil v2 geometry did not produce a trace for ${operation.displayName}.`
      );
    }
    const operationStart = lines.length;
    const programStops = preparation.programStopsByOperationId.get(operation.id)!;
    if (programStops.status === 'blocked') {
      return blockedReason(
        'program-stop-blocked',
        programStops.message,
        { operationId: operation.id, programStopReason: programStops.reason }
      );
    }
    const appendProgramStops = (
      placement: 'before-entry' | 'after-contour' | 'after-exit'
    ) => {
      programStops.stops
        .filter((stop) => stop.placement.kind === placement)
        .forEach(() => appendModal(programStops.code, 'program-stop', operation.id));
    };
    const appendProgramStopAtPoint = (point: Point2) => {
      lines.push(programStops.code);
      blocks.push({
        bodyLineIndex: lines.length - 1,
        kind: 'program-stop',
        text: programStops.code,
        operationId: operation.id,
        segmentId: null,
        startPoint: { ...point },
        endPoint: { ...point },
        command: null,
        compensationBefore: compensation,
        compensationAfter: compensation
      });
    };
    appendModal('G39', 'compensation-cancellation', operation.id);
    appendModal('G40', 'operation-boundary', operation.id);
    appendProgramStops('before-entry');
    const threading = operationIndex === 0
      ? null
      : resolveOperationThreadingTransition(document, operation.id, machine);
    if (threading?.status === 'blocked') {
      return blockedReason(
        'threading-transition-blocked',
        threading.message,
        { operationId: operation.id, threadingReason: threading.reason }
      );
    }
    if (
      threading?.transition.mode === 'manual' &&
      threading.transition.wireSeparation === 'manual-before-positioning'
    ) {
      appendModal(threading.manualStopCode!, 'wire-separation', operation.id);
    } else if (threading?.transition.mode === 'automatic') {
      threading.automaticBeforePositioningCodes!.forEach((code) =>
        appendModal(code, 'automatic-rethread', operation.id)
      );
    }
    const cutMoves = geometryOperation.moves.filter((move) => move.kind !== 'rapid');
    const entryPoint = operationEntryPoint(operation);
    const entryWords = formatGcodePointWords(entryPoint, machine.output.coordinatePrecision);
    if (!entryWords) {
      return blockedReason(
        'post-audit-failed',
        `Robofil v2 could not format the canonical rapid destination for ${operation.displayName}.`
      );
    }
    if (!pointsWithinTolerance(currentPosition, entryPoint, effectiveDocumentEndpointTolerance(document))) {
      appendMove({
        bodyLineIndex: 0,
        command: 'G0',
        contourId: operation.contourId,
        endPoint: { ...entryPoint },
        kind: 'rapid',
        operationId: operation.id,
        reason: 'operation-start',
        segmentId: null,
        startPoint: { ...currentPosition },
        text: `G0 ${entryWords}`
      }, operationIndex === 0 ? 'rapid' : 'position-for-threading');
    }
    if (threading?.transition.mode === 'manual') {
      appendModal(threading.manualStopCode!, 'manual-rethread', operation.id);
    } else if (threading?.transition.mode === 'automatic') {
      threading.automaticAfterPositioningCodes!.forEach((code) =>
        appendModal(code, 'automatic-rethread', operation.id)
      );
    }
    const compensationCode = preparation.resolutionByOperationId.get(operation.id)!;
    appendModal(
      `${compensationCode} D${machine.compensation.offsetSelection.index}`,
      'compensation-activation',
      operation.id
    );
    const distanceStopPoints = resolveProgramStopPoints(document, operation.id);
    if (distanceStopPoints.status === 'blocked') {
      return blockedReason(
        'program-stop-blocked',
        `The remaining-distance stop for ${operation.displayName} could not be resolved.`
      );
    }
    const splitIssue = appendContourMovesWithStops({
      appendMove,
      appendProgramStopAtPoint,
      document,
      machine,
      moves: cutMoves,
      stops: distanceStopPoints.stops
    });
    if (splitIssue) return blockedReason('program-stop-blocked', splitIssue);
    currentPosition = cutMoves.at(-1)?.endPoint ?? entryPoint;
    appendProgramStops('after-contour');
    const exit = operation.transitions?.exit;
    if (exit && exit.strategy !== 'none') {
      if (exit.review !== 'reviewed') {
        return blockedReason(
          'operation-transition-review-required',
          `Review the exit transition for ${operation.displayName} before exporting.`
        );
      }
      const tolerance = effectiveDocumentEndpointTolerance(document);
      if (!pointsWithinTolerance(currentPosition, exit.from, tolerance)) {
        return blockedReason(
          'operation-transition-disconnected',
          `The exit transition for ${operation.displayName} is not connected to the contour end.`
        );
      }
      const exitWords = formatGcodePointWords(exit.to, machine.output.coordinatePrecision);
      if (!exitWords) {
        return blockedReason(
          'post-formatting-failed',
          `Robofil v2 could not format the exit transition for ${operation.displayName}.`
        );
      }
      appendMove({
        bodyLineIndex: 0,
        command: 'G1',
        contourId: operation.contourId,
        endPoint: { ...exit.to },
        kind: 'cut',
        operationId: operation.id,
        reason: 'compensation-lead-out',
        segmentId: null,
        startPoint: { ...exit.from },
        text: `G1 ${exitWords}`
      }, 'lead-out');
      currentPosition = { ...exit.to };
    }
    appendProgramStops('after-exit');
    const postedOperationMoves = moves.filter((move) => move.operationId === operation.id);
    operations.push({
      ...geometryOperation,
      bodyLineStart: operationStart,
      bodyLineEnd: lines.length - 1,
      moves: postedOperationMoves,
      rapidCount: postedOperationMoves.filter((move) => move.kind === 'rapid').length,
      cutMoveCount: postedOperationMoves.filter((move) => move.kind === 'cut').length
    });
  }

  appendModal('G39', 'compensation-cancellation');
  appendModal('G40', 'compensation-cancellation');
  templateLines(machine.templates.footer).forEach((line) => appendModal(line, 'template'));
  appendModal('M02', 'program-end');

  const auditIssue = auditRobofilV2Program({
    lines,
    blocks,
    operationIds: document.plan.operations.map((operation) => operation.id)
  });
  if (auditIssue) return blockedReason('post-audit-failed', auditIssue);

  return {
    status: 'ready',
    body: lines.join('\n'),
    diagnostics: geometry.diagnostics,
    metrics: {
      rapidCount: moves.filter((move) => move.kind === 'rapid').length,
      cutMoveCount: moves.filter((move) => move.kind === 'cut').length
    },
    moves,
    operations,
    blocks,
    programOwned: true
  };
}

function appendContourMovesWithStops(input: {
  appendMove: (move: GcodePostedMove, kind?: GcodePostedBlockKind) => GcodePostedMove;
  appendProgramStopAtPoint: (point: Point2) => void;
  document: PathPlanningDocument;
  machine: MachineProfile;
  moves: GcodePostedMove[];
  stops: Array<{
    id: string;
    placement: 'before-operation-end';
    point: Point2;
    remainingCutLengthMm: number;
  }>;
}) {
  const contourMoves = input.moves.filter(isContourCutMove);
  const totalLength = contourMoves.reduce(
    (total, move) => total + postedMoveLength(move, input.document),
    0
  );
  const pending = input.stops
    .map((stop) => ({ ...stop, distanceFromStart: totalLength - stop.remainingCutLengthMm }))
    .sort((left, right) => left.distanceFromStart - right.distanceFromStart);
  let contourDistance = 0;
  let stopIndex = 0;
  const tolerance = effectiveDocumentEndpointTolerance(input.document);

  for (const move of input.moves) {
    if (!isContourCutMove(move)) {
      input.appendMove(move);
      continue;
    }
    const moveLength = postedMoveLength(move, input.document);
    if (!Number.isFinite(moveLength) || moveLength <= 0 || !move.startPoint) {
      return 'A contour move containing a program stop has invalid posted geometry.';
    }
    const moveEndDistance = contourDistance + moveLength;
    let currentStart = { ...move.startPoint };
    while (
      pending[stopIndex] &&
      pending[stopIndex].distanceFromStart <= moveEndDistance + tolerance
    ) {
      const stop = pending[stopIndex];
      if (stop.distanceFromStart < contourDistance - tolerance) {
        return 'A remaining-distance program stop resolved outside the posted contour.';
      }
      if (!pointsWithinTolerance(currentStart, stop.point, tolerance)) {
        const text = formatSplitMove(move, stop.point, input.document, input.machine);
        if (!text) return 'A split contour move for a program stop could not be formatted.';
        input.appendMove({
          ...move,
          bodyLineIndex: -1,
          startPoint: currentStart,
          endPoint: { ...stop.point },
          text
        });
      }
      input.appendProgramStopAtPoint(stop.point);
      currentStart = { ...stop.point };
      stopIndex += 1;
    }
    if (!pointsWithinTolerance(currentStart, move.endPoint, tolerance)) {
      input.appendMove({
        ...move,
        bodyLineIndex: -1,
        startPoint: currentStart
      });
    }
    contourDistance = moveEndDistance;
  }
  return stopIndex === pending.length
    ? null
    : 'A remaining-distance program stop did not resolve onto the posted contour.';
}

function isContourCutMove(move: GcodePostedMove) {
  return move.reason === 'segment-cut' ||
    move.reason === 'gap-bridge' ||
    move.reason === 'unexpected-gap';
}

function postedMoveLength(move: GcodePostedMove, document: PathPlanningDocument) {
  if (!move.startPoint) return Number.NaN;
  if (move.command === 'G0' || move.command === 'G1') {
    return Math.hypot(
      move.endPoint.x - move.startPoint.x,
      move.endPoint.y - move.startPoint.y
    );
  }
  const segment = document.segments.find((candidate) => candidate.id === move.segmentId);
  if (!segment || (segment.kind !== 'arc' && segment.kind !== 'circle')) return Number.NaN;
  const startAngle = Math.atan2(
    move.startPoint.y - segment.center.y,
    move.startPoint.x - segment.center.x
  );
  const endAngle = Math.atan2(
    move.endPoint.y - segment.center.y,
    move.endPoint.x - segment.center.x
  );
  const delta = move.command === 'G2'
    ? normalizePositiveAngle(startAngle - endAngle)
    : normalizePositiveAngle(endAngle - startAngle);
  return segment.radius * (delta === 0 ? Math.PI * 2 : delta);
}

function formatSplitMove(
  move: GcodePostedMove,
  endPoint: Point2,
  document: PathPlanningDocument,
  machine: MachineProfile
) {
  const endWords = formatGcodePointWords(endPoint, machine.output.coordinatePrecision);
  if (!endWords) return null;
  if (move.command === 'G1') return `G1 ${endWords}`;
  if (move.command !== 'G2' && move.command !== 'G3') return null;
  const segment = document.segments.find((candidate) => candidate.id === move.segmentId);
  if (!segment || (segment.kind !== 'arc' && segment.kind !== 'circle')) return null;
  const precision = machine.output.coordinatePrecision;
  return `${move.command} ${endWords} I${segment.center.x.toFixed(precision)} J${segment.center.y.toFixed(precision)}`;
}

function normalizePositiveAngle(value: number) {
  const fullTurn = Math.PI * 2;
  return ((value % fullTurn) + fullTurn) % fullTurn;
}

function auditRobofilV2Program(input: {
  lines: string[];
  blocks: GcodePostedBlock[];
  operationIds: string[];
}) {
  if (input.blocks.length !== input.lines.length) {
    return 'Robofil v2 line and structured-block counts disagree.';
  }
  if (input.blocks.some((block, index) =>
    block.bodyLineIndex !== index || block.text !== input.lines[index]
  )) {
    return 'Robofil v2 line and structured-block indexes disagree.';
  }
  const rapidBlocks = input.blocks.filter((block) =>
    block.kind === 'rapid' || block.kind === 'position-for-threading'
  );
  if (rapidBlocks.some((block) =>
    block.compensationBefore !== 'G40' || block.compensationAfter !== 'G40'
  )) {
    return 'Robofil v2 contains a rapid while controller compensation is active.';
  }
  for (const operationId of input.operationIds) {
    const operationBlocks = input.blocks.filter((block) => block.operationId === operationId);
    const boundaryIndex = input.blocks.findIndex((block) =>
      block.operationId === operationId && block.kind === 'operation-boundary'
    );
    const activationBlocks = operationBlocks.filter((block) => block.kind === 'compensation-activation');
    const rapidBlocksForOperation = operationBlocks.filter((block) =>
      block.kind === 'rapid' || block.kind === 'position-for-threading'
    );
    const activationIndex = activationBlocks[0]?.bodyLineIndex ?? -1;
    const transitionBlocks = input.blocks.slice(boundaryIndex + 1, activationIndex);
    const firstCutIndex = input.blocks.findIndex((block) =>
      block.operationId === operationId &&
      (block.kind === 'lead-in' || block.kind === 'contour')
    );
    if (
      boundaryIndex < 1 ||
      input.blocks[boundaryIndex - 1]?.text !== 'G39' ||
      input.blocks[boundaryIndex]?.text !== 'G40' ||
      rapidBlocksForOperation.length > 1 ||
      activationBlocks.length !== 1 ||
      activationIndex <= boundaryIndex ||
      transitionBlocks.some((block) =>
        block.operationId !== operationId ||
        ![
          'rapid',
          'wire-separation',
          'position-for-threading',
          'manual-rethread',
          'automatic-rethread',
          'program-stop'
        ].includes(block.kind)
      ) ||
      rapidBlocksForOperation.some((block) =>
        block.bodyLineIndex <= boundaryIndex || block.bodyLineIndex >= activationIndex
      ) ||
      firstCutIndex !== activationIndex + 1 ||
      operationBlocks.some((block) =>
        block.compensationBefore !== block.compensationAfter &&
        block.kind !== 'operation-boundary' &&
        block.kind !== 'compensation-activation'
      )
    ) {
      return `Robofil v2 operation ${operationId} has an invalid cancellation/activation boundary.`;
    }
  }
  if (input.lines.slice(-3).join('\n') !== 'G39\nG40\nM02') {
    return 'Robofil v2 must cancel compensation before M02.';
  }
  return null;
}

function pointsWithinTolerance(first: Point2, second: Point2, tolerance: number) {
  return Math.hypot(first.x - second.x, first.y - second.y) <= tolerance;
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
  compensationCode: 'G41' | 'G42',
  g92Words: string
) {
  return [
    `G92 ${g92Words}`,
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

function operationIssue(
  operation: PathPlanningDocument['plan']['operations'][number],
  reason: string,
  scope = preparationIssueScope(reason)
): UpidMachinePostPreparationIssue {
  return {
    reason,
    scope,
    effectiveOperationId: operation.id,
    sourceOperationId:
      operation.machiningIntent?.sourceOperationId ?? operation.id
  };
}

function globalPreparationIssue(
  reason: string,
  scope = preparationIssueScope(reason)
): UpidMachinePostPreparationIssue {
  return { reason, scope };
}

function preparationIssues(
  reason: string,
  operations: readonly PathPlanningDocument['plan']['operations'][number][],
  failureOwner?: Extract<
    CompensatedExportReadiness,
    { status: 'blocked' }
  >['failureOwner']
): UpidMachinePostPreparationIssue[] {
  const scope = failureOwner === 'machine-profile'
    ? 'machine-setup'
    : failureOwner === 'contour-start'
      ? 'contour-start'
      : preparationIssueScope(reason);
  return scope === 'entry-exit' ||
    scope === 'contour-start' ||
    scope === 'cut-path' ||
    scope === 'program-stop'
    ? operations.map((operation) => operationIssue(operation, reason, scope))
    : [globalPreparationIssue(reason, scope)];
}

function preparationIssueScope(
  reason: string
): UpidMachinePostPreparationIssue['scope'] {
  switch (reason) {
    case 'program-stop-post-unsupported':
    case 'program-stop-blocked':
      return 'program-stop';
    case 'unsafe-radial-lead':
    case 'unsafe-controller-compensation-lead-in':
      return 'entry-exit';
    case 'compensation-resolution-blocked':
      return 'cut-path';
    case 'initial-wire-position-required':
      return 'initial-wire';
    case 'partial-controller-side-required':
      return 'machining-participation';
    case 'unsupported-machine-profile':
    case 'invalid-offset-selection':
    case 'unverified-machine-profile':
    case 'units-mode-conflict':
    case 'template-modal-conflict':
    case 'unsupported-generic-post-envelope':
    case 'unsupported-robofil-post-envelope':
    case 'unsupported-operation-count':
    case 'unsupported-compensation-lifecycle':
      return 'machine-setup';
    default:
      return 'cut-path';
  }
}

function blockedPreparation(
  result: UpidMachinePostResult,
  options: {
    reason?: string;
    document?: PathPlanningDocument;
    machining?: ReturnType<typeof deriveActiveMachiningOperations>;
    issues?: UpidMachinePostPreparationIssue[];
  } = {}
): Extract<UpidMachinePostPreparation, { status: 'blocked' }> {
  return {
    status: 'blocked',
    result,
    ...(options.reason ? { reason: options.reason } : {}),
    ...(options.document ? { document: options.document } : {}),
    ...(options.machining ? { machining: options.machining } : {}),
    issues: options.issues ?? []
  };
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
