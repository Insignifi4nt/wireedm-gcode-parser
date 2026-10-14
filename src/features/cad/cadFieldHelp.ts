import type { CadFeature } from '@/domain/cad/cadDocument';

const joinHelp = 'For Join/Union, a contained tool can leave material unchanged. Edge/point contact or separated additions can leave multiple solids under one body. Keep additions as separate bodies when independent identities are needed.';

export const cadFeatureHelp: Record<CadFeature['kind'], string> = {
  'datum-plane': 'A reference frame for sketches and features. Changing it moves dependent geometry while retaining its local dimensions.',
  sketch: 'Draw closed profiles on a plane. Nested profiles become holes; construction profiles are references.',
  curve: 'An open chain of lines and arcs. It can guide a Sweep, but it does not enclose material.',
  imported: 'The original imported geometry is fixed. Later features modify the solid while the source is retained.',
  extrude: `Extend a closed sketch along its plane normal. New body creates material; Join adds it to a body; Cut removes it. ${joinHelp}`,
  pocket: 'Remove material through a target body using the selected closed sketch and direction.',
  revolve: `Rotate a closed sketch around its selected axis. The angle controls how far it turns. ${joinHelp}`,
  loft: `Connect closed sketch sections in their listed order. Ruled creates straight transitions; smooth fits between sections. ${joinHelp}`,
  sweep: `Carry a closed sketch along an open curve. The section must face the start of the curve and fit along the route. ${joinHelp}`,
  fillet: 'Round selected solid edges with circular transitions. All edges applies to the entire body; to choose edges, cancel, pick them, then start Fillet.',
  chamfer: 'Replace selected solid edges with straight bevels. All edges applies to the entire body; to choose edges, cancel, pick them, then start Chamfer.',
  shell: 'Remove the selected planar opening face and offset remaining walls inward. Wall thickness must fit inside the body.',
  boolean: `Combine two independent bodies by adding their material, subtracting one, or keeping their intersection. ${joinHelp}`,
  transform: 'Move and rotate the source body in world coordinates. Earlier history retains the original placement.',
  'linear-pattern': 'Repeat the source body using the spacing between consecutive instances. The count includes the original.',
  'circular-pattern': 'Repeat a body around the world axis through the specified center. The count includes the original.',
  mirror: 'Reflect the source body across the selected world plane through the origin.',
};

export function cadScalarHelp(label: string) {
  switch (label) {
    case 'Radius': return 'Distance from a circle center to its outline, or the radius of a rounded edge.';
    case 'Corner radius': return 'Rounding at rectangle corners. Zero keeps square corners; it must fit inside the rectangle.';
    case 'Wall thickness': return 'Material left between the inner and outer walls of the shell. A value too large for the body is rejected.';
    case 'Angular extent': return 'The angle occupied by the circular pattern. A full turn distributes instances around 360 degrees.';
    case 'Angle': return 'Rotation or angular extent in degrees, according to the selected feature and axis.';
    case 'Offset': return 'Signed displacement along the selected reference plane normal.';
    case 'Width': return 'The transverse size of this profile in its local reference frame.';
    case 'Height': return 'The profile size along its local Y direction.';
    case 'Length': return 'The distance used by this profile or solid feature. For a Pad, it follows the sketch normal.';
    case 'Distance': return 'The size of the straight bevel measured by the chamfer operation.';
    default: return `Controls ${label.toLowerCase()} in this feature's reference frame. Changes rebuild dependent features after Apply.`;
  }
}
