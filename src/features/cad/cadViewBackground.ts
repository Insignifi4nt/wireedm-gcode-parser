import * as THREE from 'three';

/**
 * CATIA's graduated view background in the workbench's dark palette: deep navy overhead fading to slate below. The lower
 * stop stays dark enough for the orange depth handles and source highlights to keep their contrast.
 * `cad-workbench.css` repeats these stops as `--cad-view-top` and `--cad-view-bottom` for the sketch canvas.
 */
export const CAD_VIEW_BACKGROUND = Object.freeze({ top: 0x0e1a2a, bottom: 0x1a2731 });

/** A vertical gradient the renderer stretches over the whole view, blended in sRGB like the CSS gradient on the sketch canvas. */
export function cadViewBackground(): THREE.Texture {
  const rows = 256, pixels = new Uint8Array(rows * 4);
  const channel = (value: number, shift: number) => (value >> shift) & 255;
  for (let row = 0; row < rows; row++) {
    // Texture rows start at the bottom of the view.
    const amount = row / (rows - 1);
    [16, 8, 0].forEach((shift, index) => { pixels[row * 4 + index] = Math.round(channel(CAD_VIEW_BACKGROUND.bottom, shift) + (channel(CAD_VIEW_BACKGROUND.top, shift) - channel(CAD_VIEW_BACKGROUND.bottom, shift)) * amount); });
    pixels[row * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, 1, rows);
  texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return texture;
}
