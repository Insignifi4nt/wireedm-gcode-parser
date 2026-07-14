import { normalizeMachineProfile } from '@/domain/machine/machineProfiles';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import {
  WORKBENCH_MANIFEST_FILE,
  type ConnectedWorkbench,
  type WorkbenchManifest
} from '@/domain/storage/workbenchStorage';
import { createWorkbenchProject } from '@/domain/workbench/defaultProject';
import { baseNameFromFileName } from '@/domain/workbench/projectNaming';
import type { WorkbenchProject, WorkbenchUpidState } from '@/domain/workbench/types';

import { createProjectUpid, projectUpidDocument } from './projectUpid';
import { validateUpidDocument } from './validateUpidDocument';

export interface PortableUpidProjectExport {
  fileName: string;
  text: string;
}

export interface ImportPortableUpidProjectInput {
  fileName: string;
  text: string;
  now?: Date;
}

export interface ImportPortableUpidProjectResult {
  workbench: ConnectedWorkbench;
  project: WorkbenchProject;
  pathDocument: PathPlanningDocument;
}

export async function exportPortableUpidProject(
  workbench: ConnectedWorkbench,
  projectPath: string
): Promise<PortableUpidProjectExport> {
  const projectText = await workbench.adapter.readText(projectPath);
  if (projectText === null) {
    throw new Error(`Workbench project file not found: ${projectPath}`);
  }

  const project = parseWorkbenchProject(projectText, projectPath);
  const pathDocument = projectUpidDocument(project);
  const document = pathDocument ? portableDocumentClone(pathDocument) : null;
  if (!document) {
    throw new Error('Only path projects can be exported as UPID.');
  }
  delete document.source.projectId;

  const portable: WorkbenchUpidState = {
    format: 'upid',
    schemaVersion: 1,
    document
  };

  return {
    fileName: `${portableFileBaseName(project.name)}.upid.json`,
    text: JSON.stringify(portable, null, 2)
  };
}

export async function importPortableUpidProject(
  workbench: ConnectedWorkbench,
  input: ImportPortableUpidProjectInput
): Promise<ImportPortableUpidProjectResult> {
  const portable = parsePortableUpid(input.text);
  const report = validateUpidDocument(portable.document);
  if (!report.structurallyValid) {
    throw new Error(
      `Invalid UPID document: ${report.structuralDiagnostics
        .map((diagnostic) => diagnostic.message)
        .join('; ')}`
    );
  }

  const timestamp = (input.now ?? new Date()).toISOString();
  const projectName = baseNameFromFileName(input.fileName, {
    fallback: 'UPID Import',
    stripExtension: /\.upid\.json$/i
  });
  const initialProject = createWorkbenchProject({
    name: projectName,
    sourceKind: 'upid',
    now: input.now
  });
  const projectId = await availableProjectId(workbench, initialProject.id);
  const project = projectId === initialProject.id
    ? initialProject
    : createWorkbenchProject({
        id: projectId,
        name: projectName,
        sourceKind: 'upid',
        now: input.now
      });
  project.machine = normalizeMachineProfile(structuredClone(workbench.activeMachineProfile));
  const importedDocument = portableDocumentClone(portable.document);
  delete importedDocument.source.projectId;
  project.upid = createProjectUpid(project, importedDocument);

  const projectDirectory = `projects/${project.id}`;
  const projectPath = `${projectDirectory}/project.json`;
  const updatedManifest: WorkbenchManifest = {
    ...workbench.manifest,
    updatedAt: timestamp,
    projects: [
      ...workbench.manifest.projects,
      {
        id: project.id,
        name: project.name,
        path: projectPath,
        sourceKind: 'upid',
        updatedAt: timestamp
      }
    ]
  };

  await workbench.adapter.ensureDirectory(projectDirectory);
  await workbench.adapter.writeText(projectPath, JSON.stringify(project, null, 2));
  await workbench.adapter.writeText(
    WORKBENCH_MANIFEST_FILE,
    JSON.stringify(updatedManifest, null, 2)
  );

  return {
    workbench: { ...workbench, manifest: updatedManifest },
    project,
    pathDocument: project.upid.document
  };
}

function parseWorkbenchProject(text: string, projectPath: string): WorkbenchProject {
  try {
    return JSON.parse(text) as WorkbenchProject;
  } catch {
    throw new Error(`Workbench project file is not valid JSON: ${projectPath}`);
  }
}

function parsePortableUpid(text: string): WorkbenchUpidState {
  let parsed: Partial<WorkbenchUpidState>;
  try {
    parsed = JSON.parse(text) as Partial<WorkbenchUpidState>;
  } catch {
    throw new Error('UPID project file is not valid JSON.');
  }

  if (parsed.format !== 'upid') {
    throw new Error(`Unsupported UPID project format: ${String(parsed.format)}.`);
  }
  if (parsed.schemaVersion !== 1) {
    throw new Error(`Unsupported UPID project schema version: ${String(parsed.schemaVersion)}.`);
  }
  return parsed as WorkbenchUpidState;
}

function portableFileBaseName(name: string) {
  const safe = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '');
  return safe || 'UPID Project';
}

async function availableProjectId(workbench: ConnectedWorkbench, baseId: string) {
  const manifestIds = new Set(workbench.manifest.projects.map(({ id }) => id));

  for (let suffix = 1; suffix < Number.MAX_SAFE_INTEGER; suffix++) {
    const candidate = suffix === 1 ? baseId : `${baseId}-${suffix}`;
    if (manifestIds.has(candidate)) continue;
    const projectPath = `projects/${candidate}/project.json`;
    if (await workbench.adapter.readText(projectPath) === null) return candidate;
  }

  throw new Error('Could not create a unique project ID.');
}

const UPID_V1_PORTABLE_PROPERTY_NAMES = new Set([
  'allowReverseClosedContours',
  'allowReverseOpenChains',
  'appliedUnits',
  'approximatePolygon',
  'approximation',
  'approximationMaxAngleRadians',
  'area',
  'basePoint',
  'basis',
  'blockBasePoint',
  'blockName',
  'blockNames',
  'bounds',
  'chainId',
  'chains',
  'childIds',
  'classification',
  'clockwise',
  'closed',
  'code',
  'coincidenceEpsilon',
  'column',
  'compensationIntent',
  'confidence',
  'confirmed',
  'confirmedAt',
  'containmentDepth',
  'contourId',
  'contours',
  'coordinateScaleToMillimeters',
  'createdSegmentIds',
  'cutLength',
  'derivedSegmentIds',
  'diagnosticIds',
  'diagnostics',
  'direction',
  'displayName',
  'drawing',
  'dxf',
  'edit',
  'end',
  'endAngleRadians',
  'endClusterId',
  'endPoint',
  'endpointClusters',
  'endpointTolerance',
  'entityCount',
  'events',
  'exact',
  'excludeLayers',
  'extents',
  'fileName',
  'from',
  'gapLength',
  'geometryBasis',
  'id',
  'importWarnings',
  'importedAt',
  'includeLayers',
  'insertBlockNames',
  'insertChain',
  'insertedSegmentCount',
  'insertion',
  'keptMaterial',
  'kind',
  'label',
  'layer',
  'layers',
  'leadIn',
  'length',
  'localOffset',
  'max',
  'maxChordError',
  'maxPairDistance',
  'maxX',
  'maxY',
  'members',
  'message',
  'method',
  'metrics',
  'min',
  'minX',
  'minY',
  'mode',
  'move',
  'note',
  'operationCount',
  'operationId',
  'operationOrderStrategy',
  'operations',
  'options',
  'order',
  'orderIndex',
  'orientation',
  'overrides',
  'parentId',
  'parentSegmentId',
  'parentSegmentIds',
  'pathElements',
  'plan',
  'point',
  'pointRole',
  'points',
  'preferredStart',
  'profileId',
  'projectId',
  'provenance',
  'radius',
  'rapidInLength',
  'rawValue',
  'relatedChainIds',
  'relatedClusterIds',
  'relatedContourIds',
  'relatedSegmentIds',
  'relation',
  'representativePoint',
  'reversed',
  'role',
  'rootPathElementIds',
  'rotationDegrees',
  'row',
  'scaleToMillimeters',
  'scaleX',
  'scaleY',
  'schemaVersion',
  'segmentCount',
  'segmentId',
  'segmentRefs',
  'segments',
  'severity',
  'side',
  'signedArea',
  'source',
  'sourceEntityHandle',
  'sourceEntityHandles',
  'sourceEntityIndex',
  'sourceEntityIndices',
  'sourceEntityType',
  'sourceEntityTypes',
  'sourceSegmentId',
  'sourceSegmentIndex',
  'sourceSubIndex',
  'start',
  'startAngleRadians',
  'startClusterId',
  'startPoint',
  'status',
  'suggestion',
  'sweepRadians',
  'to',
  'toleranceUsed',
  'totalCutLength',
  'totalRapidLength',
  'transform',
  'unitDeclaration',
  'units',
  'x',
  'y'
]);

function portableDocumentClone(document: PathPlanningDocument) {
  const clone = structuredClone(document);
  stripUnknownPortableProperties(clone);
  return clone;
}

function stripUnknownPortableProperties(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(stripUnknownPortableProperties);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  for (const [key, nestedValue] of Object.entries(record)) {
    if (!UPID_V1_PORTABLE_PROPERTY_NAMES.has(key)) {
      delete record[key];
    } else {
      stripUnknownPortableProperties(nestedValue);
    }
  }
}
