import type { CadMesh, CadPlane } from '@/domain/cad/cadDocument';

/** Suggested section position only; the exact native preview still validates material. */
export function cadSectionMiddleOffset(body: Pick<CadMesh, 'bounds'> | undefined, plane: CadPlane): string {
  if (!body) return '0';
  const axis = plane === 'XY' ? 2 : plane === 'XZ' ? 1 : 0;
  return String((body.bounds.min[axis] / 2 + body.bounds.max[axis] / 2) * (plane === 'XZ' ? -1 : 1));
}
