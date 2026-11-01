import * as THREE from 'three';
import { CAD_VIEW_BACKGROUND } from '../cadViewBackground';
import type { CadViewportReference } from '../cadViewportReferences';

/** How far Dimmed blends the model toward the view background behind it. */
export const CAD_SKETCH_DIM_AMOUNT = 0.62;

type DimUniforms = {
  readonly cadDim: { value: number };
  readonly cadDimTop: { value: THREE.Vector3 };
  readonly cadDimBottom: { value: THREE.Vector3 };
  readonly cadDimHeight: { value: number };
};
/**
 * Dims the 3D model behind a sketch with one shared uniform, so switching between Normal and Dimmed compiles nothing and costs one frame.
 * Each fragment blends toward the gradient colour the view background has at that pixel, which is what a lower opacity shows over the
 * empty background, while depth stays as it is: the nearest surface still hides the ones behind it, so the part keeps reading as 3D, and
 * no transparency sorting is involved.
 */
export interface CadBackgroundDim {
  readonly uniforms: DimUniforms;
  /** Draws the model as it is at 0 and as the background at 1. Reports whether the amount changed. */
  setAmount(amount: number): boolean;
  /** The drawing buffer height in pixels, which places each fragment on the background gradient. */
  setHeight(pixels: number): void;
  /** Lets the dim reach this material. */
  install(material: THREE.Material): void;
}

const srgb = (hex: number) => new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
const DIM_DECLARATIONS = 'uniform float cadDim;\nuniform vec3 cadDimTop;\nuniform vec3 cadDimBottom;\nuniform float cadDimHeight;\n';
// After the output colour conversion the colour is in sRGB, as the background gradient's stops are, so the blend matches the CSS gradient.
const DIM_ANCHOR = '#include <premultiplied_alpha_fragment>';
const DIM_BLEND = `${DIM_ANCHOR}\n\tgl_FragColor.rgb = mix( gl_FragColor.rgb, mix( cadDimBottom, cadDimTop, clamp( gl_FragCoord.y / cadDimHeight, 0.0, 1.0 ) ), cadDim );`;

/** Adds the dim to one fragment shader, or leaves a shader without the anchor unchanged. */
export function cadDimFragmentShader(source: string): string {
  return source.includes(DIM_ANCHOR) ? DIM_DECLARATIONS + source.replace(DIM_ANCHOR, DIM_BLEND) : source;
}

export function createCadBackgroundDim(): CadBackgroundDim {
  const uniforms: DimUniforms = { cadDim: { value: 0 }, cadDimTop: { value: srgb(CAD_VIEW_BACKGROUND.top) }, cadDimBottom: { value: srgb(CAD_VIEW_BACKGROUND.bottom) }, cadDimHeight: { value: 1 } };
  const compile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = cadDimFragmentShader(shader.fragmentShader);
  };
  return {
    uniforms,
    setAmount(amount) { if (uniforms.cadDim.value === amount) return false; uniforms.cadDim.value = amount; return true; },
    setHeight(pixels) { uniforms.cadDimHeight.value = Math.max(1, pixels); },
    install(material) { material.onBeforeCompile = compile; material.customProgramCacheKey = () => 'cad-background-dim'; },
  };
}

/** Reference planes, axes and the origin stay out of a sketch's background; only sketch and curve outlines show behind it. */
const isPlane = (reference: CadViewportReference) => reference.featureKind !== 'sketch' && reference.featureKind !== 'curve';
const sameNumbers = (a: readonly number[] | undefined, b: readonly number[] | undefined) => a === b || Boolean(a && b && a.length === b.length && a.every((value, index) => value === b[index]));
const samePlane = (a: CadViewportReference['plane'], b: CadViewportReference['plane']) => a === b || typeof a === 'object' && typeof b === 'object' && a.featureId === b.featureId;
/** Whether two references draw the same lines, so the one already installed can stay. */
function sameDrawing(a: CadViewportReference, b: CadViewportReference): boolean {
  return a === b || a.referenceId === b.referenceId && a.featureId === b.featureId && a.featureKind === b.featureKind && a.name === b.name && a.construction === b.construction
    && samePlane(a.plane, b.plane) && sameNumbers(a.bounds.min, b.bounds.min) && sameNumbers(a.bounds.max, b.bounds.max)
    && sameNumbers(a.labelPosition, b.labelPosition) && sameNumbers(a.planePatch, b.planePatch) && sameNumbers(a.positions, b.positions);
}
/**
 * The references drawn behind an open sketch: every other sketch and curve. The open sketch draws itself on the canvas, and planes stay out of
 * the way of the sketch on top of them. A reference that draws the same lines as one in `previous` is that one, and when nothing changed
 * `previous` itself comes back, so the viewport keeps its lines and draws no frame while only the open sketch changes. Curves are prepared
 * anew with every document, which is why the lines, not the objects, are compared.
 */
export function cadSketchBackgroundReferences(prepared: readonly CadViewportReference[], openFeatureId: string, previous: readonly CadViewportReference[] | null): readonly CadViewportReference[] {
  const before = new Map(previous?.map(reference => [reference.referenceId, reference]));
  const next = prepared.filter(reference => !isPlane(reference) && reference.featureId !== openFeatureId).map(reference => {
    const kept = before.get(reference.referenceId);
    return kept && sameDrawing(kept, reference) ? kept : reference;
  });
  return previous && previous.length === next.length && previous.every((reference, index) => reference === next[index]) ? previous : Object.freeze(next);
}
