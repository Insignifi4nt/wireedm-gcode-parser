import { getQuickJS, type QuickJSContext, type QuickJSHandle } from 'quickjs-emscripten';

import type {
  WireEdmExecutionEvent,
  WireEdmExecutionPlan
} from '@/domain/execution-plan/executionPlan';
import type { Point2 } from '@/domain/path-intel/types';
import {
  auditControllerProgram,
  type ControllerMotionTrace,
  type ControllerProgram,
  type ControllerProgramBlock,
  type PostEventDisposition
} from '@/domain/post-processor/controllerProgram';
import { preflightPostCapabilities } from '@/domain/post-processor/postCapabilityPreflight';
import type { WireEdmPostPackage } from '@/domain/post-processor/postPackageSchema';
import {
  validatePostPropertyValues,
  type PostPropertyValue
} from '@/domain/post-processor/postProperties';

export interface CustomPostRuntimeLimits {
  readonly memoryBytes: number;
  readonly stackBytes: number;
  readonly interruptCycles: number;
  readonly deadlineMs: number;
  readonly events: number;
  readonly actions: number;
  readonly outputBytes: number;
}

export const DEFAULT_CUSTOM_POST_RUNTIME_LIMITS: CustomPostRuntimeLimits = Object.freeze({
  memoryBytes: 16 * 1024 * 1024,
  stackBytes: 512 * 1024,
  interruptCycles: 100_000,
  deadlineMs: 250,
  events: 20_000,
  actions: 100_000,
  outputBytes: 4 * 1024 * 1024
});

export const CUSTOM_POST_DIAGNOSTIC_CODES = [
  'POST_CUSTOM_PROPERTY_INVALID',
  'POST_CUSTOM_CAPABILITY_UNSUPPORTED',
  'POST_CUSTOM_EVENT_LIMIT',
  'POST_CUSTOM_SOURCE_INVALID',
  'POST_CUSTOM_EXPORT_INVALID',
  'POST_CUSTOM_HANDLER_INVALID',
  'POST_CUSTOM_RUNTIME_FAILED',
  'POST_CUSTOM_RESOURCE_LIMIT',
  'POST_CUSTOM_API_MISUSE',
  'POST_CUSTOM_COMMAND_UNKNOWN',
  'POST_CUSTOM_PARAMETER_INVALID',
  'POST_CUSTOM_STATE_REQUIRED',
  'POST_CUSTOM_OUTPUT_LIMIT',
  'POST_CUSTOM_EVENT_DISPOSITION_INVALID',
  'POST_CUSTOM_MOTION_ROLE_INVALID',
  'POST_CUSTOM_AUDIT_FAILED',
  'POST_CUSTOM_NONDETERMINISTIC'
] as const;

export type CustomPostDiagnosticCode = typeof CUSTOM_POST_DIAGNOSTIC_CODES[number];

export interface CustomPostDiagnostic {
  readonly code: CustomPostDiagnosticCode;
  readonly message: string;
  readonly eventId: string | null;
  readonly commandId: string | null;
}

export type CustomPostRunResult =
  | { readonly ok: true; readonly program: ControllerProgram }
  | { readonly ok: false; readonly diagnostics: readonly CustomPostDiagnostic[] };

export interface RunCustomPostInput {
  readonly package: WireEdmPostPackage;
  readonly plan: WireEdmExecutionPlan;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly limits?: Partial<CustomPostRuntimeLimits>;
}

type RuntimeCommand = WireEdmPostPackage['dialect']['commands'][string];
type RuntimeParameter = RuntimeCommand['parameters'][string];

interface MutableRunState {
  readonly lines: string[];
  readonly blocks: ControllerProgramBlock[];
  readonly dispositions: PostEventDisposition[];
  readonly dialectState: Set<string>;
  currentEvent: WireEdmExecutionEvent | null;
  currentDisposition: 'none' | 'emitted' | 'consumed';
  actionCount: number;
  outputBytes: number;
  readonly outputLimit: number;
  fatal: CustomPostDiagnostic | null;
}

export async function runCustomPost(input: RunCustomPostInput): Promise<CustomPostRunResult> {
  const limits = resolveLimits(input.limits);
  if (!limits) return failure('POST_CUSTOM_RESOURCE_LIMIT', 'Custom post limits must be finite positive integers.');
  if (input.plan.events.length > limits.events) {
    return failure(
      'POST_CUSTOM_EVENT_LIMIT',
      `Execution plan has ${input.plan.events.length} events; the limit is ${limits.events}.`
    );
  }
  const properties = validatePostPropertyValues(input.package, input.properties);
  if (!properties.ok) {
    return {
      ok: false,
      diagnostics: properties.diagnostics.map(({ message }) => diagnostic(
        'POST_CUSTOM_PROPERTY_INVALID',
        message
      ))
    };
  }
  const capabilityDiagnostics = preflightPostCapabilities(input.plan, input.package);
  if (capabilityDiagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: capabilityDiagnostics.map(({ message }) => diagnostic(
        'POST_CUSTOM_CAPABILITY_UNSUPPORTED',
        message
      ))
    };
  }

  const first = await executeOnce(input.package, input.plan, properties.values, limits);
  const second = await executeOnce(input.package, input.plan, properties.values, limits);
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    return failure(
      'POST_CUSTOM_NONDETERMINISTIC',
      'Two fresh isolated executions produced different results.'
    );
  }
  return first;
}

async function executeOnce(
  packageValue: WireEdmPostPackage,
  plan: WireEdmExecutionPlan,
  properties: Readonly<Record<string, PostPropertyValue>>,
  limits: CustomPostRuntimeLimits
): Promise<CustomPostRunResult> {
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(limits.memoryBytes);
  runtime.setMaxStackSize(limits.stackBytes);
  const startedAt = performance.now();
  let interruptCycles = 0;
  runtime.setInterruptHandler(() => {
    interruptCycles += 1;
    return interruptCycles > limits.interruptCycles || performance.now() - startedAt > limits.deadlineMs;
  });
  const context = runtime.newContext();
  const state: MutableRunState = {
    lines: [],
    blocks: [],
    dispositions: [],
    dialectState: new Set(),
    currentEvent: null,
    currentDisposition: 'none',
    actionCount: 0,
    outputBytes: 0,
    outputLimit: limits.outputBytes,
    fatal: null
  };
  const ownedHandles: QuickJSHandle[] = [];
  try {
    const sanitized = evaluate(context, hardenGuestSource(), 'wire-edm-runtime.js', 'global');
    if (!sanitized.ok) return sourceFailure(sanitized.error);
    sanitized.value.dispose();

    const loaded = evaluate(
      context,
      packageValue.source.code,
      `${packageValue.manifest.id}.post.js`,
      'module'
    );
    if (!loaded.ok) return sourceFailure(loaded.error);
    const moduleExports = loaded.value;
    ownedHandles.push(moduleExports);
    const exportNames = ownPropertyNames(context, moduleExports);
    if (!exportNames.ok) return sourceFailure(exportNames.error);
    if (exportNames.names.length !== 1 || exportNames.names[0] !== 'createPost') {
      return failure(
        'POST_CUSTOM_EXPORT_INVALID',
        'Post source must export exactly one binding named createPost.'
      );
    }
    const createPost = context.getProp(moduleExports, 'createPost');
    ownedHandles.push(createPost);
    if (context.typeof(createPost) !== 'function') {
      return failure('POST_CUSTOM_EXPORT_INVALID', 'The createPost export must be a function.');
    }

    const api = createGuestApi(context, packageValue, properties, limits, state);
    ownedHandles.push(api);
    const created = callGuest(context, createPost, context.undefined, api);
    if (!created.ok) return runtimeFailure(state, created.error);
    const post = created.value;
    ownedHandles.push(post);
    if (state.fatal) return { ok: false, diagnostics: [state.fatal] };
    const handlerShape = validatePostHandler(context, post);
    if (!handlerShape.ok) return handlerShape;
    const onEvent = context.getProp(post, 'onEvent');
    ownedHandles.push(onEvent);

    for (const event of plan.events) {
      state.currentEvent = event;
      state.currentDisposition = 'none';
      const eventValue = evaluate(
        context,
        `(${JSON.stringify(event)})`,
        'wire-edm-event.js',
        'global'
      );
      if (!eventValue.ok) return runtimeFailure(state, eventValue.error);
      const called = callGuest(context, onEvent, post, eventValue.value);
      eventValue.value.dispose();
      if (!called.ok) return runtimeFailure(state, called.error);
      called.value.dispose();
      if (state.fatal) return { ok: false, diagnostics: [state.fatal] };
      if (state.currentDisposition === 'none') {
        return failure(
          'POST_CUSTOM_EVENT_DISPOSITION_INVALID',
          `Event ${event.id} returned without emitCommand, emitMotion, or consume.`,
          event.id
        );
      }
    }
    state.currentEvent = null;
    const program = freezeProgram(state);
    const auditDiagnostics = auditControllerProgram(
      plan,
      program,
      new Set(Object.keys(packageValue.dialect.commands))
    );
    if (auditDiagnostics.length > 0) {
      return {
        ok: false,
        diagnostics: auditDiagnostics.map(({ message, eventId }) => diagnostic(
          'POST_CUSTOM_AUDIT_FAILED',
          message,
          eventId
        ))
      };
    }
    return { ok: true, program };
  } finally {
    for (const handle of ownedHandles.reverse()) {
      if (handle.alive) handle.dispose();
    }
    context.dispose();
    runtime.dispose();
  }
}

function createGuestApi(
  context: QuickJSContext,
  packageValue: WireEdmPostPackage,
  properties: Readonly<Record<string, PostPropertyValue>>,
  limits: CustomPostRuntimeLimits,
  state: MutableRunState
) {
  const api = context.newObject();
  const methods = [
    context.newFunction('getProperty', (nameHandle) => {
      state.actionCount += 1;
      if (state.actionCount > limits.actions) {
        recordFatal(state, diagnostic(
          'POST_CUSTOM_RESOURCE_LIMIT',
          `Custom post exceeded the ${limits.actions}-action limit.`,
          state.currentEvent?.id ?? null
        ));
        throw new Error(state.fatal?.message);
      }
      const name = context.dump(nameHandle);
      if (typeof name !== 'string' || !Object.hasOwn(properties, name)) {
        recordFatal(state, diagnostic(
          'POST_CUSTOM_API_MISUSE',
          `Property ${JSON.stringify(name)} is not present in the exact binding.`,
          state.currentEvent?.id ?? null
        ));
        throw new Error(state.fatal?.message);
      }
      return guestValue(context, properties[name]);
    }),
    context.newFunction('emitCommand', (commandHandle, parametersHandle) => {
      executeAction(state, limits, 'emitCommand', () => emitCommand(
        packageValue,
        properties,
        state,
        context.dump(commandHandle),
        context.dump(parametersHandle),
        false
      ));
    }),
    context.newFunction('emitMotion', (commandHandle, parametersHandle) => {
      executeAction(state, limits, 'emitMotion', () => emitCommand(
        packageValue,
        properties,
        state,
        context.dump(commandHandle),
        context.dump(parametersHandle),
        true
      ));
    }),
    context.newFunction('consume', (reasonHandle) => {
      executeAction(state, limits, 'consume', () => consumeEvent(state, context.dump(reasonHandle)));
    })
  ];
  const names = ['getProperty', 'emitCommand', 'emitMotion', 'consume'];
  methods.forEach((method, index) => context.setProp(api, names[index], method));
  methods.forEach((method) => method.dispose());
  context.setProp(context.global, '__wireEdmApi', api);
  const frozen = evaluate(
    context,
    'Object.freeze(globalThis.__wireEdmApi); delete globalThis.__wireEdmApi;',
    'wire-edm-api.js',
    'global'
  );
  if (frozen.ok) frozen.value.dispose();
  else recordFatal(state, diagnostic('POST_CUSTOM_RUNTIME_FAILED', frozen.error));
  return api;
}

function executeAction(
  state: MutableRunState,
  limits: CustomPostRuntimeLimits,
  action: string,
  execute: () => void
) {
  state.actionCount += 1;
  if (state.actionCount > limits.actions) {
    recordFatal(state, diagnostic(
      'POST_CUSTOM_RESOURCE_LIMIT',
      `Custom post exceeded the ${limits.actions}-action limit.`,
      state.currentEvent?.id ?? null
    ));
  } else if (!state.currentEvent) {
    recordFatal(state, diagnostic(
      'POST_CUSTOM_API_MISUSE',
      `${action} may only be called synchronously while handling an event.`
    ));
  } else {
    try {
      execute();
    } catch (error) {
      if (!state.fatal) recordFatal(state, diagnostic(
        'POST_CUSTOM_RUNTIME_FAILED',
        error instanceof Error ? error.message : String(error),
        state.currentEvent.id
      ));
    }
  }
  if (state.fatal) throw new Error(state.fatal.message);
}

function emitCommand(
  packageValue: WireEdmPostPackage,
  properties: Readonly<Record<string, PostPropertyValue>>,
  state: MutableRunState,
  commandValue: unknown,
  parametersValue: unknown,
  motionAction: boolean
) {
  const event = state.currentEvent;
  if (!event) return;
  if (state.currentDisposition === 'consumed') {
    recordFatal(state, diagnostic(
      'POST_CUSTOM_EVENT_DISPOSITION_INVALID',
      `Event ${event.id} cannot emit after it was consumed.`,
      event.id
    ));
    return;
  }
  if (typeof commandValue !== 'string') {
    recordFatal(state, diagnostic('POST_CUSTOM_COMMAND_UNKNOWN', 'Command ID must be a string.', event.id));
    return;
  }
  const command = packageValue.dialect.commands[commandValue];
  if (!command) {
    recordFatal(state, diagnostic(
      'POST_CUSTOM_COMMAND_UNKNOWN',
      `Dialect command ${commandValue} is not registered.`,
      event.id,
      commandValue
    ));
    return;
  }
  const parameters = validateParameters(commandValue, command, parametersValue);
  if (!parameters.ok) {
    recordFatal(state, diagnostic(
      'POST_CUSTOM_PARAMETER_INVALID',
      parameters.message,
      event.id,
      commandValue
    ));
    return;
  }
  const missingState = command.requires.find((token) => !state.dialectState.has(token));
  if (missingState) {
    recordFatal(state, diagnostic(
      'POST_CUSTOM_STATE_REQUIRED',
      `Command ${commandValue} requires dialect state ${missingState}.`,
      event.id,
      commandValue
    ));
    return;
  }
  const motion = motionAction
    ? deriveMotion(event, command, parameters.values, properties)
    : { ok: true as const, motion: null };
  if (!motion.ok) {
    recordFatal(state, diagnostic(
      'POST_CUSTOM_MOTION_ROLE_INVALID',
      motion.message,
      event.id,
      commandValue
    ));
    return;
  }
  if (!motionAction && (event.kind === 'motion' || event.kind === 'position')) {
    recordFatal(state, diagnostic(
      'POST_CUSTOM_MOTION_ROLE_INVALID',
      `Motion event ${event.id} must use emitMotion.`,
      event.id,
      commandValue
    ));
    return;
  }
  const text = renderTemplate(command.template, parameters.values);
  if (text.length === 0 || /[\r\n\u0000]/.test(text)) {
    recordFatal(state, diagnostic(
      'POST_CUSTOM_PARAMETER_INVALID',
      `Command ${commandValue} rendered an invalid controller line.`,
      event.id,
      commandValue
    ));
    return;
  }
  appendBlock(state, event, commandValue, text, motion.motion);
  applyEffects(state.dialectState, command.effects);
  state.currentDisposition = 'emitted';
}

function consumeEvent(state: MutableRunState, reasonValue: unknown) {
  const event = state.currentEvent;
  if (!event) return;
  if (state.currentDisposition !== 'none') {
    recordFatal(state, diagnostic(
      'POST_CUSTOM_EVENT_DISPOSITION_INVALID',
      `Event ${event.id} cannot be consumed after another disposition action.`,
      event.id
    ));
    return;
  }
  if (event.kind === 'motion' || event.kind === 'position') {
    recordFatal(state, diagnostic(
      'POST_CUSTOM_EVENT_DISPOSITION_INVALID',
      `Required motion event ${event.id} cannot be consumed.`,
      event.id
    ));
    return;
  }
  if (typeof reasonValue !== 'string' || reasonValue.trim().length === 0 || reasonValue.length > 512) {
    recordFatal(state, diagnostic(
      'POST_CUSTOM_API_MISUSE',
      'consume requires a non-empty reason of at most 512 characters.',
      event.id
    ));
    return;
  }
  state.dispositions.push({ kind: 'consumed', eventId: event.id, reason: reasonValue });
  state.currentDisposition = 'consumed';
}

function validateParameters(commandId: string, command: RuntimeCommand, value: unknown) {
  if (!isRecord(value)) return { ok: false as const, message: `Command ${commandId} parameters must be an object.` };
  const expected = Object.keys(command.parameters);
  const supplied = Object.keys(value);
  if (
    expected.length !== supplied.length ||
    expected.some((name) => !Object.hasOwn(value, name))
  ) {
    return {
      ok: false as const,
      message: `Command ${commandId} requires exactly these parameters: ${expected.join(', ') || '(none)'}.`
    };
  }
  const values: Record<string, string | number> = {};
  for (const name of expected) {
    const definition = command.parameters[name];
    const parameterValue = value[name];
    const problem = parameterProblem(name, definition, parameterValue);
    if (problem) return { ok: false as const, message: problem };
    if (typeof parameterValue === 'string' || typeof parameterValue === 'number') {
      values[name] = parameterValue;
    }
  }
  return { ok: true as const, values };
}

function parameterProblem(name: string, definition: RuntimeParameter, value: unknown) {
  if (definition.type === 'string') {
    return typeof value === 'string' ? null : `Parameter ${name} must be a string.`;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `Parameter ${name} must be a finite ${definition.type}.`;
  }
  if (definition.type === 'integer' && !Number.isSafeInteger(value)) {
    return `Parameter ${name} must be a safe integer.`;
  }
  if (definition.minimum !== undefined && value < definition.minimum) {
    return `Parameter ${name} must be at least ${definition.minimum}.`;
  }
  if (definition.maximum !== undefined && value > definition.maximum) {
    return `Parameter ${name} must be at most ${definition.maximum}.`;
  }
  return null;
}

function deriveMotion(
  event: WireEdmExecutionEvent,
  command: RuntimeCommand,
  values: Readonly<Record<string, string | number>>,
  properties: Readonly<Record<string, PostPropertyValue>>
): { ok: true; motion: ControllerMotionTrace } | { ok: false; message: string } {
  if (event.kind !== 'motion' && event.kind !== 'position') {
    return { ok: false, message: `emitMotion cannot be used for ${event.kind}.` };
  }
  const endX = numericRoleValue(command, values, 'motion.end-x');
  const endY = numericRoleValue(command, values, 'motion.end-y');
  if (endX === null || endY === null) {
    return { ok: false, message: 'A motion command requires one motion.end-x and one motion.end-y parameter.' };
  }
  const start = event.kind === 'position' ? event.from : event.start;
  const end = { x: endX, y: endY };
  if (event.kind === 'position') {
    return { ok: true, motion: { motion: 'linear', role: 'position', start: copyPoint(start), end } };
  }
  if (event.motion === 'linear') {
    if (hasCenterRole(command)) {
      return { ok: false, message: 'A linear motion command cannot declare arc-center roles.' };
    }
    return { ok: true, motion: { motion: 'linear', role: event.role, start: copyPoint(start), end } };
  }
  const center = deriveCenter(command, values, properties, start);
  if (!center.ok) return center;
  return {
    ok: true,
    motion: {
      motion: 'circular',
      role: event.role,
      start: copyPoint(start),
      end,
      center: center.point,
      ...(event.clockwise === undefined ? {} : { clockwise: event.clockwise }),
      ...(event.fullCircle === undefined ? {} : { fullCircle: event.fullCircle })
    }
  };
}

function deriveCenter(
  command: RuntimeCommand,
  values: Readonly<Record<string, string | number>>,
  properties: Readonly<Record<string, PostPropertyValue>>,
  start: Point2
): { ok: true; point: Point2 } | { ok: false; message: string } {
  const x = centerRole(command, values, 'motion.center-x', properties);
  const y = centerRole(command, values, 'motion.center-y', properties);
  if (!x.ok) return x;
  if (!y.ok) return y;
  if (x.mode !== y.mode) return { ok: false, message: 'Arc-center X and Y parameters must use the same reference mode.' };
  return {
    ok: true,
    point: x.mode === 'absolute'
      ? { x: x.value, y: y.value }
      : { x: start.x + x.value, y: start.y + y.value }
  };
}

function centerRole(
  command: RuntimeCommand,
  values: Readonly<Record<string, string | number>>,
  role: 'motion.center-x' | 'motion.center-y',
  properties: Readonly<Record<string, PostPropertyValue>>
):
  | { ok: true; value: number; mode: 'absolute' | 'incremental' }
  | { ok: false; message: string } {
  const entries = Object.entries(command.parameters).filter(([, parameter]) => parameter.role === role);
  if (entries.length !== 1) return { ok: false, message: `A circular command requires exactly one ${role} parameter.` };
  const [name, parameter] = entries[0];
  const value = values[name];
  if (typeof value !== 'number' || !('centerReference' in parameter)) {
    return { ok: false, message: `Parameter ${name} has invalid ${role} metadata.` };
  }
  if (parameter.centerReference.kind === 'fixed') {
    return { ok: true, value, mode: parameter.centerReference.mode };
  }
  const mode = properties[parameter.centerReference.property];
  return mode === 'absolute' || mode === 'incremental'
    ? { ok: true, value, mode }
    : { ok: false, message: `Property ${parameter.centerReference.property} is not an exact arc-center mode.` };
}

function numericRoleValue(
  command: RuntimeCommand,
  values: Readonly<Record<string, string | number>>,
  role: 'motion.end-x' | 'motion.end-y'
) {
  const names = Object.entries(command.parameters)
    .filter(([, parameter]) => parameter.role === role)
    .map(([name]) => name);
  if (names.length !== 1) return null;
  const value = values[names[0]];
  return typeof value === 'number' ? value : null;
}

function hasCenterRole(command: RuntimeCommand) {
  return Object.values(command.parameters).some(({ role }) => (
    role === 'motion.center-x' || role === 'motion.center-y'
  ));
}

function renderTemplate(template: string, values: Readonly<Record<string, string | number>>) {
  return template.replace(/\{([A-Za-z0-9._-]+)\}/g, (_placeholder, name: string) => String(values[name]));
}

function appendBlock(
  state: MutableRunState,
  event: WireEdmExecutionEvent,
  commandId: string,
  text: string,
  motion: ControllerMotionTrace | null
) {
  const addedBytes = new TextEncoder().encode(text).byteLength + (state.lines.length === 0 ? 0 : 1);
  state.outputBytes += addedBytes;
  if (state.outputBytes > state.outputLimit) {
    recordFatal(state, diagnostic(
      'POST_CUSTOM_OUTPUT_LIMIT',
      `Custom post exceeded the ${state.outputLimit}-byte output limit.`,
      event.id,
      commandId
    ));
    return;
  }
  const lineIndex = state.lines.length;
  const id = `block-${String(lineIndex + 1).padStart(6, '0')}`;
  state.lines.push(text);
  state.blocks.push({ id, lineIndex, text, eventId: event.id, commandIds: [commandId], motion });
  const previous = state.dispositions[state.dispositions.length - 1];
  if (previous?.eventId === event.id && previous.kind === 'emitted') {
    state.dispositions[state.dispositions.length - 1] = {
      ...previous,
      blockIds: [...previous.blockIds, id]
    };
  } else {
    state.dispositions.push({ kind: 'emitted', eventId: event.id, blockIds: [id] });
  }
}

function applyEffects(state: Set<string>, effects: readonly string[]) {
  for (const effect of effects) {
    if (
      effect === 'compensation.left' ||
      effect === 'compensation.right' ||
      effect === 'compensation.off'
    ) {
      state.delete('compensation.left');
      state.delete('compensation.right');
      state.delete('compensation.off');
    }
    if (effect === 'wire.separated') state.delete('wire.threaded');
    if (effect === 'wire.threaded') state.delete('wire.separated');
    state.add(effect);
  }
}

function validatePostHandler(context: QuickJSContext, post: QuickJSHandle): CustomPostRunResult {
  if (context.typeof(post) !== 'object') {
    return failure('POST_CUSTOM_HANDLER_INVALID', 'createPost must return an object containing only onEvent.');
  }
  const names = ownPropertyNames(context, post);
  if (!names.ok) return sourceFailure(names.error);
  if (names.names.length !== 1 || names.names[0] !== 'onEvent') {
    return failure('POST_CUSTOM_HANDLER_INVALID', 'createPost must return exactly { onEvent(event) }.');
  }
  const onEvent = context.getProp(post, 'onEvent');
  const valid = context.typeof(onEvent) === 'function';
  onEvent.dispose();
  return valid
    ? { ok: true, program: emptyProgram() }
    : failure('POST_CUSTOM_HANDLER_INVALID', 'onEvent must be a function.');
}

function ownPropertyNames(
  context: QuickJSContext,
  value: QuickJSHandle
): { ok: true; names: string[] } | { ok: false; error: string } {
  const result = context.getOwnPropertyNames(value);
  if (result.error) {
    const error = dumpedError(context, result.error);
    result.error.dispose();
    return { ok: false, error };
  }
  const names = result.value.map((handle) => context.getString(handle));
  result.value.dispose();
  return { ok: true, names };
}

function callGuest(
  context: QuickJSContext,
  fn: QuickJSHandle,
  thisValue: QuickJSHandle,
  ...args: QuickJSHandle[]
) {
  const result = context.callFunction(fn, thisValue, ...args);
  if (result.error) {
    const error = dumpedError(context, result.error);
    result.error.dispose();
    return { ok: false as const, error };
  }
  return { ok: true as const, value: result.value };
}

function evaluate(
  context: QuickJSContext,
  source: string,
  fileName: string,
  type: 'global' | 'module'
) {
  const result = context.evalCode(source, fileName, { type });
  if (result.error) {
    const error = dumpedError(context, result.error);
    result.error.dispose();
    return { ok: false as const, error };
  }
  return { ok: true as const, value: result.value };
}

function hardenGuestSource() {
  return `
    (() => {
      const deny = (target, name) => Object.defineProperty(target, name, {
        value: undefined, writable: false, configurable: false, enumerable: false
      });
      for (const name of [
        'Date', 'eval', 'Function', 'WebAssembly', 'performance', 'crypto', 'fetch',
        'XMLHttpRequest', 'WebSocket', 'navigator', 'localStorage', 'sessionStorage',
        'indexedDB', 'caches', 'document', 'window', 'self', 'Intl', 'WeakRef',
        'FinalizationRegistry', 'Atomics', 'SharedArrayBuffer', 'Temporal'
      ]) deny(globalThis, name);
      deny(Math, 'random');
    })();
  `;
}

function guestValue(context: QuickJSContext, value: PostPropertyValue) {
  if (typeof value === 'boolean') return value ? context.true : context.false;
  if (typeof value === 'number') return context.newNumber(value);
  return context.newString(value);
}

function dumpedError(context: QuickJSContext, handle: QuickJSHandle) {
  const value = context.dump(handle);
  if (isRecord(value) && typeof value.message === 'string') return value.message;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function runtimeFailure(state: MutableRunState, message: string): CustomPostRunResult {
  if (state.fatal) return { ok: false, diagnostics: [state.fatal] };
  const resourceFailure = /interrupted|out of memory|stack overflow/i.test(message);
  return failure(
    resourceFailure ? 'POST_CUSTOM_RESOURCE_LIMIT' : 'POST_CUSTOM_RUNTIME_FAILED',
    message,
    state.currentEvent?.id ?? null
  );
}

function sourceFailure(message: string): CustomPostRunResult {
  return failure(
    /interrupted|out of memory|stack overflow/i.test(message)
      ? 'POST_CUSTOM_RESOURCE_LIMIT'
      : 'POST_CUSTOM_SOURCE_INVALID',
    message
  );
}

function recordFatal(state: MutableRunState, value: CustomPostDiagnostic) {
  state.fatal ??= value;
}

function freezeProgram(state: MutableRunState): ControllerProgram {
  return deepFreeze({
    text: state.lines.join('\n'),
    lines: [...state.lines],
    blocks: state.blocks.map((block) => ({ ...block })),
    eventDispositions: state.dispositions.map((disposition) => ({ ...disposition }))
  });
}

function emptyProgram(): ControllerProgram {
  return { text: '', lines: [], blocks: [], eventDispositions: [] };
}

function resolveLimits(overrides: Partial<CustomPostRuntimeLimits> | undefined) {
  const limits = { ...DEFAULT_CUSTOM_POST_RUNTIME_LIMITS, ...overrides };
  return Object.values(limits).every((value) => Number.isSafeInteger(value) && value > 0)
    ? Object.freeze(limits)
    : null;
}

function diagnostic(
  code: CustomPostDiagnosticCode,
  message: string,
  eventId: string | null = null,
  commandId: string | null = null
): CustomPostDiagnostic {
  return { code, message, eventId, commandId };
}

function failure(
  code: CustomPostDiagnosticCode,
  message: string,
  eventId: string | null = null,
  commandId: string | null = null
): CustomPostRunResult {
  return { ok: false, diagnostics: [diagnostic(code, message, eventId, commandId)] };
}

function copyPoint(point: Point2): Point2 {
  return { x: point.x, y: point.y };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach((child) => deepFreeze(child));
  }
  return value;
}
