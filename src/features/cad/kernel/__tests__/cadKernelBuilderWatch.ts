import { vi } from 'vitest';
import { cadKernelBuilderFactory, type CadKernelBooleanKind } from '../cadKernelBuilders';

export type CadKernelBuilderKind = CadKernelBooleanKind | 'transform' | 'fillet' | 'chamfer';
interface NativeHandle { isDeleted(): boolean }
export interface CadKernelWatchedBuilder {
  readonly kind: CadKernelBuilderKind;
  readonly builder: NativeHandle;
  /** Raw shapes the builder returned to its adapter. */
  readonly results: readonly NativeHandle[];
  /** Native inputs the adapter made for the builder and must delete with it: a transform's gp_Trsf. */
  readonly temporaries: readonly NativeHandle[];
}
export interface CadKernelBuilderFault {
  readonly kinds: readonly CadKernelBuilderKind[];
  /** The 1-based builder of those kinds that fails, or every one of them. */
  readonly call: number | 'every';
  readonly error: Error;
}
export interface CadKernelBuilderWatch {
  /** Every builder the owned adapters made, in order. */
  readonly builders: readonly CadKernelWatchedBuilder[];
  /** The builders that threw the injected fault. */
  readonly failed: readonly CadKernelWatchedBuilder[];
  /** Builders, the raw shapes they returned and their adapter-made inputs that are still alive. */
  outstanding(): number;
  restore(): void;
}

/**
 * Watches every native builder the owned adapters construct, through their test-only factory.
 * With a fault, the chosen builder throws inside its adapter after its native operation has run, so
 * the adapter's own cleanup is what the test sees. A boolean fails at its second Build, before
 * SimplifyResult: simplification rewrites topology the result shares with its operands in place (a
 * cut tool measures a different volume afterwards, with Replicad's cut too), and the tests check the
 * operands a failed operation leaves. A transform fails at ModifiedShape, fillet and chamfer at Shape.
 */
export function watchCadKernelBuilders(fault?: CadKernelBuilderFault): CadKernelBuilderWatch {
  const builders: CadKernelWatchedBuilder[] = [], failed: CadKernelWatchedBuilder[] = [];
  let matching = 0;
  function watch<T extends object>(kind: CadKernelBuilderKind, builder: T, temporaries: readonly NativeHandle[] = []): T {
    const results: NativeHandle[] = [];
    const watched: CadKernelWatchedBuilder = { kind, builder: builder as unknown as NativeHandle, results, temporaries };
    builders.push(watched);
    const fails = fault?.kinds.includes(kind) === true && (++matching === fault.call || fault.call === 'every');
    const result = kind === 'transform' ? 'ModifiedShape' : 'Shape';
    const failing = kind === 'fuse' || kind === 'cut' || kind === 'common' ? 'Build' : result;
    const inherited = (builder as unknown as Record<string, (...input: unknown[]) => NativeHandle>)[result];
    // Own properties on this instance only: embind's overload dispatch stays on the prototype.
    Object.defineProperty(builder, result, { configurable: true, value(...input: unknown[]) {
      const raw = inherited.apply(builder, input); results.push(raw); return raw;
    } });
    if (fails && fault) Object.defineProperty(builder, failing, { configurable: true, value() { failed.push(watched); throw fault.error; } });
    return builder;
  }
  const { boolean, transform, fillet, chamfer } = cadKernelBuilderFactory;
  const spies = [
    vi.spyOn(cadKernelBuilderFactory, 'boolean').mockImplementation((kind, left, right) => watch(kind, boolean(kind, left, right))),
    vi.spyOn(cadKernelBuilderFactory, 'transform').mockImplementation((shape, transformation) => watch('transform', transform(shape, transformation), [transformation as unknown as NativeHandle])),
    vi.spyOn(cadKernelBuilderFactory, 'fillet').mockImplementation(shape => watch('fillet', fillet(shape))),
    vi.spyOn(cadKernelBuilderFactory, 'chamfer').mockImplementation(shape => watch('chamfer', chamfer(shape)))
  ];
  return {
    builders, failed,
    outstanding: () => builders.reduce((count, item) => count + [item.builder, ...item.results, ...item.temporaries].filter(handle => !handle.isDeleted()).length, 0),
    restore: () => { for (const spy of spies) spy.mockRestore(); }
  };
}
