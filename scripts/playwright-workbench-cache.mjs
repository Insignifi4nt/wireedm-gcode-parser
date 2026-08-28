import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_BROWSER_CACHE_NAMESPACE = 'wire-edm-workbench';
export const DEFAULT_WORKBENCH_FOLDER_NAME = 'WireEDM_WEB_FOLDER';

export function buildWorkbenchCacheSeed(options = {}) {
  const namespace = options.namespace ?? DEFAULT_BROWSER_CACHE_NAMESPACE;
  const folder = resolveWorkbenchFolder(options.folder);
  const manifestPath = path.join(folder, 'workbench.json');
  const manifest = readJsonFile(manifestPath, 'workbench.json');
  requireV2Manifest(manifest);
  const selectedProject = selectProject(manifest.projects, options.project ?? 'latest');
  const projectPath = normalizeStoragePath(selectedProject.path, 'project path');
  const projectDocument = readJsonFile(path.join(folder, projectPath), projectPath);
  requireV2Project(projectDocument, selectedProject.id);
  const files = collectReferencedFiles(manifest, selectedProject, projectDocument);
  const directories = collectDirectories(files);
  const entries = [
    [`${namespace}:directories`, JSON.stringify(directories)],
    ...files.map((filePath) => [
      `${namespace}:file:${filePath}`,
      fs.readFileSync(path.join(folder, filePath), 'utf8')
    ])
  ];

  return {
    namespace,
    folder,
    selectedProject: {
      ...selectedProject,
      path: projectPath
    },
    projectDocument,
    files,
    directories,
    entries
  };
}

export function resolveWorkbenchFolder(folder) {
  const candidates = [
    folder,
    process.env.WIREDM_PLAYWRIGHT_WORKBENCH,
    process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, 'Documents', DEFAULT_WORKBENCH_FOLDER_NAME)
      : null,
    process.env.HOME
      ? path.join(process.env.HOME, 'Documents', DEFAULT_WORKBENCH_FOLDER_NAME)
      : null
  ].filter(Boolean);

  const existing = candidates.find((candidate) =>
    fs.existsSync(path.join(path.resolve(candidate), 'workbench.json'))
  );

  if (!existing) {
    throw new Error(
      `Workbench folder not found. Set WIREDM_PLAYWRIGHT_WORKBENCH or pass --folder <path>. Tried: ${candidates
        .map((candidate) => path.resolve(candidate))
        .join(', ')}`
    );
  }

  return path.resolve(existing);
}

export function selectProject(projects, selector = 'latest') {
  if (!Array.isArray(projects) || projects.length === 0) {
    throw new Error('Workbench manifest has no projects to seed.');
  }

  if (selector === 'latest') {
    return [...projects].sort(compareProjectsNewestFirst)[0];
  }

  const selected = projects.find((project) =>
    [project.id, project.path, project.name].includes(selector)
  );
  if (!selected) {
    throw new Error(`Workbench project not found: ${selector}`);
  }

  return selected;
}

function collectReferencedFiles(manifest, selectedProject, projectDocument) {
  return uniqueSorted([
    'workbench.json',
    'machines/library.json',
    'posts/library.json',
    selectedProject.path,
    projectDocument.content.kind === 'external-gcode'
      ? projectDocument.content.activeFilePath
      : null,
    ...readFileRefs(projectDocument.source.files)
  ].map((filePath) => filePath && normalizeStoragePath(filePath, 'file path')));
}

function readFileRefs(files) {
  if (!Array.isArray(files)) return [];
  return files.map((file) => file?.path).filter(Boolean);
}

function collectDirectories(files) {
  return uniqueSorted(
    files
      .map((filePath) => path.posix.dirname(filePath))
      .filter((directory) => directory && directory !== '.')
  );
}

function normalizeStoragePath(value, label) {
  const raw = String(value ?? '').replace(/\\/g, '/').trim();
  if (!raw) {
    throw new Error(`Invalid empty ${label}.`);
  }

  const normalized = path.posix.normalize(raw);
  if (
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return normalized;
}

function readJsonFile(filePath, displayPath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read ${displayPath}: ${error.message}`);
  }
}

function requireV2Manifest(manifest) {
  if (
    manifest?.format !== 'wire-edm-workbench' ||
    manifest?.schemaVersion !== 2 ||
    !Array.isArray(manifest.projects)
  ) {
    throw new Error('Playwright seeding requires a strict Wire EDM workbench schema version 2 manifest.');
  }
}

function requireV2Project(project, expectedId) {
  if (
    project?.format !== 'wire-edm-project' ||
    project?.schemaVersion !== 2 ||
    project?.id !== expectedId ||
    !Array.isArray(project?.source?.files) ||
    !['upid-document', 'external-gcode'].includes(project?.content?.kind)
  ) {
    throw new Error(`Playwright seeding requires an exact schema version 2 project: ${expectedId}.`);
  }
}

function compareProjectsNewestFirst(left, right) {
  const rightTime = Date.parse(right.updatedAt ?? '') || 0;
  const leftTime = Date.parse(left.updatedAt ?? '') || 0;
  if (rightTime !== leftTime) return rightTime - leftTime;
  return String(right.id ?? '').localeCompare(String(left.id ?? ''));
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}
