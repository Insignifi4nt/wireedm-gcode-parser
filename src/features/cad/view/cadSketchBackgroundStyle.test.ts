import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CAD_PRINCIPAL_PLANE_REFERENCES, type CadViewportReference } from '../cadViewportReferences';
import { CAD_SKETCH_DIM_AMOUNT, cadDimFragmentShader, cadSketchBackgroundReferences, createCadBackgroundDim } from './cadSketchBackgroundStyle';

const ANCHOR = '#include <premultiplied_alpha_fragment>';
const reference = (referenceId: string, featureId: string, featureKind: 'sketch' | 'curve' | 'datum-plane', positions = [0, 0, 0, 10, 0, 0]): CadViewportReference => Object.freeze({
  referenceId, featureId, featureKind, name: referenceId, construction: false, positions, bounds: { min: [0, 0, 0] as const, max: [10, 0, 0] as const } });

describe('sketch background style', () => {
  it('blends every lit, basic and dashed model shader toward the background after its output colour, and nothing else', () => {
    for (const shader of [THREE.ShaderLib.physical.fragmentShader, THREE.ShaderLib.basic.fragmentShader, THREE.ShaderLib.dashed.fragmentShader]) {
      const dimmed = cadDimFragmentShader(shader);
      expect(dimmed.startsWith('uniform float cadDim;')).toBe(true);
      const blend = dimmed.indexOf('gl_FragColor.rgb = mix( gl_FragColor.rgb'), anchor = dimmed.indexOf(ANCHOR);
      expect(anchor).toBeGreaterThan(0);
      // After the colour space conversion and premultiplied alpha, so the blend is in the sRGB of the CSS background.
      expect(blend).toBeGreaterThan(anchor);
      expect(dimmed.indexOf('#include <colorspace_fragment>')).toBeLessThan(anchor);
    }
    const plain = 'void main() { gl_FragColor = vec4(1.0); }';
    expect(cadDimFragmentShader(plain)).toBe(plain);
  });

  it('shares one dim amount with every installed material and compiles one program variant for Normal and Dimmed', () => {
    const dim = createCadBackgroundDim(), body = new THREE.MeshStandardMaterial(), edges = new THREE.LineBasicMaterial();
    dim.install(body); dim.install(edges);
    expect(body.customProgramCacheKey()).toBe(edges.customProgramCacheKey());
    const compiled = (material: THREE.Material) => {
      const shader = { uniforms: {} as Record<string, THREE.IUniform>, fragmentShader: `void main() {\n\t${ANCHOR}\n}`, vertexShader: '' } as unknown as THREE.WebGLProgramParametersWithUniforms;
      material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
      return shader;
    };
    const bodyShader = compiled(body), edgeShader = compiled(edges);
    expect(bodyShader.fragmentShader).toContain('cadDimTop');
    expect(dim.setAmount(CAD_SKETCH_DIM_AMOUNT)).toBe(true);
    expect(dim.setAmount(CAD_SKETCH_DIM_AMOUNT)).toBe(false);
    expect(bodyShader.uniforms.cadDim.value).toBe(CAD_SKETCH_DIM_AMOUNT);
    expect(edgeShader.uniforms.cadDim).toBe(bodyShader.uniforms.cadDim);
    dim.setHeight(0);
    expect(bodyShader.uniforms.cadDimHeight.value).toBe(1);
    dim.setHeight(1200);
    expect(edgeShader.uniforms.cadDimHeight.value).toBe(1200);
    // The background colours are the view gradient's stops, in sRGB like the CSS gradient.
    expect((bodyShader.uniforms.cadDimTop.value as THREE.Vector3).toArray().map(value => Math.round(value * 255))).toEqual([0x0e, 0x1a, 0x2a]);
    expect((bodyShader.uniforms.cadDimBottom.value as THREE.Vector3).toArray().map(value => Math.round(value * 255))).toEqual([0x1a, 0x27, 0x31]);
  });

  it('draws every other sketch and curve behind the open sketch and keeps the installed references while their lines stay the same', () => {
    const open = reference('top/outline', 'top', 'sketch'), base = reference('base/outline', 'base', 'sketch');
    const curve = reference('rail', 'rail', 'curve', [0, 0, 0, 5, 5, 5]), datum = reference('mount', 'mount', 'datum-plane');
    const first = cadSketchBackgroundReferences([...CAD_PRINCIPAL_PLANE_REFERENCES, datum, base, open, curve], 'top', null);
    expect(first.map(entry => entry.referenceId)).toEqual(['base/outline', 'rail']);
    // A new document prepares the open sketch and the curve anew; the drawn lines are the same, so the previous list comes back.
    const edited = reference('top/outline', 'top', 'sketch', [0, 0, 0, 20, 0, 0]), curveAgain = reference('rail', 'rail', 'curve', [0, 0, 0, 5, 5, 5]);
    expect(cadSketchBackgroundReferences([...CAD_PRINCIPAL_PLANE_REFERENCES, datum, base, edited, curveAgain], 'top', first)).toBe(first);
    // A changed curve replaces only itself.
    const moved = reference('rail', 'rail', 'curve', [0, 0, 0, 5, 5, 6]);
    const next = cadSketchBackgroundReferences([base, open, moved], 'top', first);
    expect(next).not.toBe(first);
    expect(next[0]).toBe(first[0]);
    expect(next[1]).toBe(moved);
    expect(cadSketchBackgroundReferences([open, moved], 'top', next).map(entry => entry.referenceId)).toEqual(['rail']);
  });
});
