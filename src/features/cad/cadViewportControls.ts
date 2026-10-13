import { Type, type Static } from '@sinclair/typebox';
import type { CadPlane } from '@/domain/cad/cadDocument';
import { CadTopologyPickSetSchema, type CadTopologyPickSet } from '@/domain/cad/cadTopology';
import type { EditorPreviewCapture } from '@/features/webmcp/previewCapture';
import type { CadPickMode, CadTopologyHit } from './cadTopologyPicking';

export const CadNamedViewSchema = Type.Union([Type.Literal('Isometric'), Type.Literal('Top'), Type.Literal('Front'), Type.Literal('Right')]);
export type CadNamedView = Static<typeof CadNamedViewSchema>;
const id = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$' });
const strict = { additionalProperties: false };
export const CadPickModeSchema = Type.Union([Type.Literal('body'), Type.Literal('face'), Type.Literal('edge')]);
export const CadViewportCommandSchema = Type.Union([
  Type.Object({ kind: Type.Literal('set-view'), view: CadNamedViewSchema }, strict),
  Type.Object({ kind: Type.Literal('fit') }, strict),
  Type.Object({ kind: Type.Literal('set-grid'), visible: Type.Boolean() }, strict),
  Type.Object({ kind: Type.Literal('select-feature'), featureId: Type.Union([id, Type.Null()]) }, strict),
  Type.Object({ kind: Type.Literal('edit-sketch'), sketchId: id }, strict),
  Type.Object({ kind: Type.Literal('edit-curve'), curveId: id }, strict),
  Type.Object({ kind: Type.Literal('select-profile'), profileId: Type.Union([id, Type.Null()]) }, strict),
  Type.Object({ kind: Type.Literal('finish-sketch') }, strict),
  Type.Object({ kind: Type.Literal('finish-curve') }, strict),
  Type.Object({ kind: Type.Literal('set-pick-mode'), mode: CadPickModeSchema }, strict),
  Type.Object({ kind: Type.Literal('select-topology'), selection: CadTopologyPickSetSchema, additive: Type.Boolean() }, strict),
  Type.Object({ kind: Type.Literal('clear-topology') }, strict)
]);
export type CadViewportCommand = Static<typeof CadViewportCommandSchema>;

export type CadRenderedViewState =
  | { readonly mode: 'solid'; readonly available: boolean; readonly view: CadNamedView | 'Custom'; readonly gridVisible: boolean; readonly zoom: number; readonly revision: number; readonly hoveredTopology?: CadTopologyHit | null; readonly referenceVersion?: string | null; readonly referenceFeatureIds?: readonly string[] }
  | { readonly mode: 'sketch' | 'curve'; readonly available: boolean; readonly plane: CadPlane; readonly gridVisible: boolean; readonly snapEnabled: boolean; readonly gridStepMm: number; readonly centerMm: readonly [number, number]; readonly heightSpanMm: number; readonly revision: number };

export interface CadRenderedViewControls {
  getState(): CadRenderedViewState;
  fit(): void;
  setGrid(visible: boolean): void;
  setView?(view: CadNamedView): void;
  capture(signal: AbortSignal): Promise<EditorPreviewCapture>;
}

export interface CadViewportState {
  readonly documentId: string;
  readonly documentVersion: string;
  readonly dirty: boolean;
  readonly selectedFeatureId: string | null;
  readonly selectedProfileId: string | null;
  readonly sketchId: string | null;
  readonly curveId: string | null;
  readonly workflowOpen: boolean;
  readonly busy: boolean;
  readonly buildVersion: string | null;
  readonly buildId: string | null;
  readonly pickMode: CadPickMode;
  readonly topologySelection: CadTopologyPickSet | null;
  readonly buildState: 'idle' | 'building' | 'ready' | 'error';
  readonly visibleBodyIds: readonly string[];
  readonly view: CadRenderedViewState | null;
}

/** Both 2D and 3D show the current CAD draft, including unsaved edits. */
export interface CadViewportCapture {
  readonly image: EditorPreviewCapture;
  readonly contentSource: 'cad-draft';
  readonly documentId: string;
  readonly documentVersion: string;
  readonly dirty: boolean;
  readonly sketchId: string | null;
  readonly curveId: string | null;
  readonly buildVersion: string | null;
  readonly viewState: CadViewportState;
}

export interface CadWorkbenchViewportControls {
  getState(): CadViewportState;
  apply(command: CadViewportCommand): void;
  capture(signal: AbortSignal): Promise<CadViewportCapture>;
}
