/**
 * What a driving value measures: a length in sketch millimetres, an angle in degrees, a whole count, or a ratio without a unit. Sketch
 * relations declare one for each of their values, and features can declare theirs the same way.
 */
export const CAD_SKETCH_QUANTITIES = Object.freeze(['length', 'angle', 'count', 'ratio'] as const);
export type CadSketchQuantity = typeof CAD_SKETCH_QUANTITIES[number];
