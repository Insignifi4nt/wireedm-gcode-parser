/** Per-import budgets include intermediate block geometry, not just final entities. */
export const DXF_RESOURCE_LIMITS = Object.freeze({
  inputBytes: 16 * 1024 * 1024,
  metadataCharacters: 4_096,
  expandedDataBytes: 64 * 1024 * 1024,
  pairs: 500_000,
  sourceWork: 10_000_000,
  entities: 20_000,
  geometryPoints: 100_000,
  insertInstances: 20_000,
  insertDepth: 32,
  warnings: 10_000,
  splineDegree: 16,
  splineDepth: 20,
  splineControlPoints: 4_096,
  splinePoints: 20_000,
  splineWork: 10_000_000
});

type DxfResource = keyof typeof DXF_RESOURCE_LIMITS;

const RESOURCE_LABELS: Record<DxfResource, string> = {
  inputBytes: 'source size', pairs: 'source complexity', sourceWork: 'source parsing complexity', entities: 'expanded geometry entities',
  metadataCharacters: 'metadata field length', expandedDataBytes: 'estimated expanded document size',
  geometryPoints: 'expanded geometry points', insertInstances: 'block array instances',
  insertDepth: 'block nesting depth', warnings: 'import diagnostics', splineDegree: 'spline degree',
  splineDepth: 'spline subdivision depth',
  splineControlPoints: 'spline control points', splinePoints: 'approximated spline points',
  splineWork: 'spline complexity'
};

export class DxfResourceLimitError extends Error {
  readonly code = 'DXF_IMPORT_RESOURCE_LIMIT';

  constructor(readonly resource: DxfResource, readonly limit = DXF_RESOURCE_LIMITS[resource]) {
    const formattedLimit = resource === 'inputBytes' || resource === 'expandedDataBytes'
      ? `${limit / (1024 * 1024)} MiB` : limit.toLocaleString('en-US');
    super(`DXF import exceeds the ${RESOURCE_LABELS[resource]} limit (${formattedLimit}). No geometry was imported. Simplify the drawing or split it into smaller DXF files.`);
    this.name = 'DxfResourceLimitError';
  }
}

export class DxfResourceBudget {
  private readonly used = new Map<DxfResource, number>();

  check(resource: DxfResource, amount: number) {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > DXF_RESOURCE_LIMITS[resource]) {
      throw new DxfResourceLimitError(resource);
    }
  }

  reserve(resource: DxfResource, amount: number) {
    const total = (this.used.get(resource) ?? 0) + amount;
    this.check(resource, total);
    this.used.set(resource, total);
  }

  /**
   * Bound serialization of parser-owned, acyclic JSON-shaped data without
   * stringifying it. Six bytes per UTF-16 unit covers escaping and UTF-8;
   * numbers use a conservative 32-byte allowance. Shared values are counted
   * on every occurrence because JSON serialization repeats them too.
   */
  reserveExpandedData(value: unknown) {
    const pending = [value];
    while (pending.length > 0) {
      const current = pending.pop();
      if (typeof current === 'string') {
        this.reserve('expandedDataBytes', 2 + current.length * 6);
      } else if (typeof current === 'number') {
        this.reserve('expandedDataBytes', 32);
      } else if (current === null || typeof current === 'boolean' || current === undefined) {
        this.reserve('expandedDataBytes', 5);
      } else if (Array.isArray(current)) {
        this.reserve('expandedDataBytes', 2 + current.length);
        for (const entry of current) pending.push(entry);
      } else if (typeof current === 'object') {
        this.reserve('expandedDataBytes', 2);
        for (const [key, entry] of Object.entries(current)) {
          this.reserve('expandedDataBytes', key.length * 6 + 4);
          pending.push(entry);
        }
      }
    }
  }
}

/** Call before File.text() so an oversized local file never needs decoding. */
export function assertDxfFileSize(size: number) {
  new DxfResourceBudget().check('inputBytes', size);
}

export function assertDxfTextSize(text: string) {
  assertDxfFileSize(text.length);
  let bytes = 0;
  let lines = 1;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 10 && ++lines > DXF_RESOURCE_LIMITS.pairs * 2 + 2) {
      throw new DxfResourceLimitError('pairs');
    }
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff &&
      text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index++;
    } else bytes += 3;
    if (bytes > DXF_RESOURCE_LIMITS.inputBytes) throw new DxfResourceLimitError('inputBytes');
  }
}
