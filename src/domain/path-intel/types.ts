export interface Point2 {
  x: number;
  y: number;
}

export interface Bounds2 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type SegmentId = string;
export type EndpointClusterId = string;
export type ChainId = string;
export type ContourId = string;
export type OperationId = string;
export type DiagnosticId = string;

export type EndpointSide = 'start' | 'end';

export interface PathPlanningOptions {
  endpointTolerance?: number;
  coincidenceEpsilon?: number;
  startPoint?: Point2;
  allowReverseOpenChains?: boolean;
  allowReverseClosedContours?: boolean;
  approximationMaxAngleRadians?: number;
}

export type ResolvedPathPlanningOptions = Required<PathPlanningOptions>;

export const DEFAULT_PATH_PLANNING_OPTIONS: ResolvedPathPlanningOptions = {
  endpointTolerance: 0.001,
  coincidenceEpsilon: 1e-9,
  startPoint: { x: 0, y: 0 },
  allowReverseOpenChains: false,
  allowReverseClosedContours: true,
  approximationMaxAngleRadians: Math.PI / 18
};

export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export interface PathDiagnostic {
  id: DiagnosticId;
  severity: DiagnosticSeverity;
  code:
    | 'zero-length-segment'
    | 'invalid-arc'
    | 'invalid-polyline'
    | 'endpoint-cluster-snap'
    | 'ambiguous-endpoint-cluster'
    | 'branching-topology'
    | 'open-chain'
    | 'closed-chain-gap'
    | 'self-intersection'
    | 'degenerate-contour'
    | 'route-dependency-cycle'
    | 'post-bridged-gap'
    | 'post-unexpected-gap';
  message: string;
  relatedSegmentIds?: SegmentId[];
  relatedClusterIds?: EndpointClusterId[];
  relatedChainIds?: ChainId[];
  relatedContourIds?: ContourId[];
  details?: Record<string, unknown>;
}

export interface SegmentSourceRef {
  sourceEntityIndex: number;
  sourceEntityType: 'line' | 'arc' | 'circle' | 'lwpolyline' | string;
  sourceSubIndex?: number;
  layer: string | null;
  exact: boolean;
  note?: string;
}

export interface BasePathSegment {
  id: SegmentId;
  source: SegmentSourceRef;
  layer: string | null;
  start: Point2;
  end: Point2;
  length: number;
  bounds: Bounds2;
}

export interface LinePathSegment extends BasePathSegment {
  kind: 'line';
}

export interface ArcPathSegment extends BasePathSegment {
  kind: 'arc';
  center: Point2;
  radius: number;
  startAngleRadians: number;
  endAngleRadians: number;
  sweepRadians: number;
  clockwise: boolean;
}

export interface CirclePathSegment extends BasePathSegment {
  kind: 'circle';
  center: Point2;
  radius: number;
  preferredStart: Point2;
}

export type PathSegment = LinePathSegment | ArcPathSegment | CirclePathSegment;

export interface OrientedSegmentRef {
  segmentId: SegmentId;
  reversed: boolean;
}

export interface EndpointRef {
  segmentId: SegmentId;
  side: EndpointSide;
}

export interface EndpointClusterMember extends EndpointRef {
  point: Point2;
}

export interface EndpointCluster {
  id: EndpointClusterId;
  point: Point2;
  members: EndpointClusterMember[];
  method: 'exact' | 'within-tolerance';
  toleranceUsed: number;
  radius: number;
  maxPairDistance: number;
}

export interface EndpointClusterResult {
  clusters: EndpointCluster[];
  endpointToCluster: Record<string, EndpointClusterId>;
  diagnostics: PathDiagnostic[];
}

export interface PathChainMetrics {
  segmentCount: number;
  cutLength: number;
  gapLength: number;
}

export interface PathChain {
  id: ChainId;
  kind: 'closed-contour' | 'open-chain';
  segmentRefs: OrientedSegmentRef[];
  closed: boolean;
  startClusterId: EndpointClusterId | null;
  endClusterId: EndpointClusterId | null;
  metrics: PathChainMetrics;
  diagnosticIds: DiagnosticId[];
}

export interface ChainBuildResult {
  chains: PathChain[];
  diagnostics: PathDiagnostic[];
}

export type ContourClassification = 'exterior' | 'hole' | 'island' | 'ambiguous' | 'open-chain';
export type ContourOrientation = 'ccw' | 'cw' | 'degenerate';

export interface PathContour {
  id: ContourId;
  chainId: ChainId;
  closed: boolean;
  classification: ContourClassification;
  signedArea: number | null;
  area: number | null;
  orientation: ContourOrientation | null;
  bounds: Bounds2;
  containmentDepth: number;
  parentId: ContourId | null;
  childIds: ContourId[];
  representativePoint: Point2 | null;
  approximatePolygon: Point2[];
  confidence: number;
  diagnosticIds: DiagnosticId[];
}

export interface ContourAnalysisResult {
  contours: PathContour[];
  diagnostics: PathDiagnostic[];
}

export interface PathOperationMetrics {
  cutLength: number;
  rapidInLength: number;
  segmentCount: number;
}

export interface PathOperation {
  id: OperationId;
  orderIndex: number;
  contourId: ContourId;
  chainId: ChainId;
  classification: ContourClassification;
  closed: boolean;
  segmentRefs: OrientedSegmentRef[];
  startPoint: Point2;
  endPoint: Point2;
  direction: 'forward' | 'reverse';
  metrics: PathOperationMetrics;
}

export interface OperationPlanMetrics {
  operationCount: number;
  totalCutLength: number;
  totalRapidLength: number;
}

export interface OperationPlan {
  operations: PathOperation[];
  metrics: OperationPlanMetrics;
  diagnostics: PathDiagnostic[];
}

export interface SegmentBuildResult {
  segments: PathSegment[];
  diagnostics: PathDiagnostic[];
}

export interface PathPlanningDocument {
  schemaVersion: 1;
  source: {
    kind: 'dxf-entities';
    entityCount: number;
  };
  options: ResolvedPathPlanningOptions;
  segments: PathSegment[];
  endpointClusters: EndpointCluster[];
  chains: PathChain[];
  contours: PathContour[];
  plan: OperationPlan;
  diagnostics: PathDiagnostic[];
}
