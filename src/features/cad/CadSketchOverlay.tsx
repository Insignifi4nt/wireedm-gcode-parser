import type { ReactNode } from 'react';
import type { SketchPoint } from './cadSketchInteraction';
import './cad-sketch-overlay.css';

/**
 * The view the sketch canvas draws: `width` by `span` sketch millimetres around `center`, with `mmPerPixel` millimetres in one screen pixel.
 * The canvas makes one per view, so every overlay drawn with it lines up with the canvas geometry exactly.
 */
export interface CadSketchViewFrame { readonly center: SketchPoint; readonly width: number; readonly span: number; readonly mmPerPixel: number }
export function cadSketchViewFrame(center: SketchPoint, width: number, span: number, viewportHeight: number): CadSketchViewFrame {
  return Object.freeze({ center, width, span, mmPerPixel: span / (viewportHeight || 600) });
}

/**
 * A transparent SVG over the sketch canvas, in the canvas frame, for drawing that follows the pointer: previews, snap hints, readouts and
 * the selection box. It takes no pointer events, so every pick still belongs to the canvas, and it paints on its own layer, so a change in
 * it repaints only itself instead of the whole canvas. Children draw like the canvas geometry: sketch millimetres from the frame center, Y up.
 * Each overlay names its `layer`; later layers stack in the order they are mounted.
 */
export function CadSketchOverlay({ frame, layer, children }: { readonly frame: CadSketchViewFrame; readonly layer: string; readonly children?: ReactNode }) {
  return <svg className="cad-sketch-overlay" data-cad-sketch-overlay={layer} aria-hidden="true" focusable="false"
    viewBox={`${-frame.width / 2} ${-frame.span / 2} ${frame.width} ${frame.span}`} preserveAspectRatio="none">
    <g transform="scale(1,-1)" strokeWidth={frame.span / 450}>{children}</g>
  </svg>;
}
