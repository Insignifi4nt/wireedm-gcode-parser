import type { CadSketchProfile } from '@/domain/cad/cadDocument';
import type { CadSketchSnapTarget } from './cadSketchGeometrySnaps';

/** Transient boundary ordinals describe this accepted profile, never graph identities. */
export function cadSketchProfileSnapLabel(target: Extract<CadSketchSnapTarget, { kind: 'profile-position' }>, profiles: readonly CadSketchProfile[]): string {
  const index = profiles.findIndex(profile => profile.id === target.profileId), profile = profiles[index];
  const name = profile ? profile.name + (profiles.some(other => other.id !== profile.id && other.name === profile.name) ? ` (profile ${index + 1})` : '') : 'Unavailable profile';
  const location = target.location;
  const role = location.kind === 'center' ? 'Center' : location.kind === 'endpoint' ? `Boundary point ${location.boundaryIndex + 1}`
    : location.kind === 'midpoint' ? `Boundary midpoint ${location.boundaryIndex + 1}` : `Arc center ${location.boundaryIndex + 1}`;
  return `${name} · ${role}`;
}
