import { describe, expect, it, vi } from 'vitest';

import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { MACHINE_LIBRARY_PATH } from '@/domain/machine-definition/machineLibraryStorage';
import { POST_LIBRARY_PATH } from '@/domain/post-processor/postLibraryStorage';

import {
  initializeWorkbenchCatalog,
  WORKBENCH_CATALOG_PATH
} from '../workbenchCatalog';
import { addStoredWorkbenchProject } from '../workbenchCatalogMutations';
import { createWorkbenchProjectDocument } from '../workbenchProject';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>();

  constructor(
    readonly name = 'catalog-test',
    private failCatalogWriteOnce = false
  ) {}
  async ensureDirectory(path: string) { this.directories.add(path); }
  async readText(path: string) { return this.files.get(path) ?? null; }
  async writeText(path: string, contents: string) {
    if (path === WORKBENCH_CATALOG_PATH && this.failCatalogWriteOnce) {
      this.failCatalogWriteOnce = false;
      throw new Error('catalog write denied');
    }
    this.files.set(path, contents);
  }
  async deleteText(path: string) { this.files.delete(path); }
}

describe('clean-break workbench catalog', () => {
  it('holds the named cross-tab mutation lock while initializing and recovering storage', async () => {
    const previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
    const request = vi.fn(async (_name: string, callback: () => Promise<unknown>) => callback());
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request }
    });

    try {
      expect(await initializeWorkbenchCatalog(new MemoryAdapter('Locked shop'))).toMatchObject({
        ok: true,
        kind: 'created'
      });
      expect(request).toHaveBeenCalledWith(
        'wire-edm-workbench:memory:Locked shop',
        expect.any(Function)
      );
    } finally {
      if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
      else Reflect.deleteProperty(navigator, 'locks');
    }
  });

  it('creates explicit empty state without a default machine, post, or export configuration', async () => {
    const adapter = new MemoryAdapter('Shop workbench');

    const result = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-08-28T12:00:00.000Z')
    });

    expect(result).toMatchObject({
      ok: true,
      kind: 'created',
      workbench: {
        manifest: {
          format: 'wire-edm-workbench',
          schemaVersion: 3,
          name: 'Shop workbench',
          preferences: {
            importUnits: { mode: 'ask' },
            recentPlanningMachineId: null
          },
          projects: []
        },
        posts: { installations: [] },
        machines: { machines: [] }
      }
    });
    expect(adapter.files.has(POST_LIBRARY_PATH)).toBe(true);
    expect(adapter.files.has(MACHINE_LIBRARY_PATH)).toBe(true);
    expect(JSON.parse(adapter.files.get(WORKBENCH_CATALOG_PATH) ?? '')).toMatchObject({
      schemaVersion: 3
    });
  });

  it('migrates a version-1 workbench and its projects without inventing a machine package', async () => {
    const adapter = new MemoryAdapter('Legacy shop');
    const projectPath = 'projects/legacy-part.json';
    const timestamp = '2026-08-28T12:00:00.000Z';
    adapter.files.set(projectPath, JSON.stringify({
      schemaVersion: 1,
      id: 'legacy-part',
      name: 'Legacy part',
      createdAt: timestamp,
      updatedAt: timestamp,
      source: { kind: 'upid', files: [] },
      upid: { format: 'upid', schemaVersion: 1, document: createUpidFromDxfEntities([]) },
      machine: { id: 'legacy-profile' },
      editor: { activeFilePath: null, pinnedLineNumbers: [] }
    }));
    adapter.files.set(WORKBENCH_CATALOG_PATH, JSON.stringify({
      schemaVersion: 1,
      name: 'Legacy shop',
      createdAt: timestamp,
      updatedAt: timestamp,
      templates: { headerPath: 'templates/header.gcode', footerPath: 'templates/footer.gcode' },
      output: { extension: 'iso', lineEnding: 'crlf', coordinatePrecision: 3 },
      activeMachineProfileId: 'legacy-profile',
      machineProfiles: [{ id: 'legacy-profile', preferredDxfImportUnit: 'millimeters' }],
      projects: [{ id: 'legacy-part', name: 'Legacy part', path: projectPath, sourceKind: 'upid', updatedAt: timestamp }]
    }));

    expect(await initializeWorkbenchCatalog(adapter)).toMatchObject({
      ok: true,
      workbench: {
        manifest: {
          schemaVersion: 3,
          preferences: { importUnits: { mode: 'fixed', unit: 'millimeters' }, recentPlanningMachineId: null },
          projects: [{ id: 'legacy-part' }]
        },
        posts: { installations: [] },
        machines: { machines: [] }
      }
    });
    expect(JSON.parse(adapter.files.get(projectPath) ?? '{}')).toMatchObject({
      format: 'wire-edm-project',
      schemaVersion: 2,
      id: 'legacy-part'
    });
    expect(adapter.files.get('legacy/v1/workbench.json')).toContain('"schemaVersion":1');
    expect(adapter.files.get('legacy/v1/projects/legacy-part.json')).toContain('"legacy-profile"');
  });

  it('resumes version-1 migration from empty companion catalogs left before manifest replacement', async () => {
    const adapter = new MemoryAdapter('Interrupted legacy shop');
    const projectPath = 'projects/interrupted.json';
    const timestamp = '2026-08-28T12:00:00.000Z';
    const legacyProject = JSON.stringify({
      schemaVersion: 1,
      id: 'interrupted',
      name: 'Interrupted',
      createdAt: timestamp,
      updatedAt: timestamp,
      source: { kind: 'upid', files: [] },
      upid: { format: 'upid', schemaVersion: 1, document: createUpidFromDxfEntities([]) },
      machine: { id: 'legacy-profile' },
      editor: { activeFilePath: null, pinnedLineNumbers: [] }
    });
    const legacyManifest = JSON.stringify({
      schemaVersion: 1,
      name: 'Interrupted legacy shop',
      createdAt: timestamp,
      updatedAt: timestamp,
      templates: { headerPath: null, footerPath: null },
      output: { extension: 'iso', lineEnding: 'crlf', coordinatePrecision: 3 },
      activeMachineProfileId: 'legacy-profile',
      machineProfiles: [{ id: 'legacy-profile', preferredDxfImportUnit: 'millimeters' }],
      projects: [{ id: 'interrupted', name: 'Interrupted', path: projectPath, sourceKind: 'upid', updatedAt: timestamp }]
    });
    adapter.files.set(projectPath, legacyProject);
    adapter.files.set(WORKBENCH_CATALOG_PATH, legacyManifest);
    adapter.files.set('legacy/v1/workbench.json', legacyManifest);
    adapter.files.set('legacy/v1/projects/interrupted.json', legacyProject);
    adapter.files.set(POST_LIBRARY_PATH, JSON.stringify({
      format: 'wire-edm-post-library', schemaVersion: 1, installations: []
    }, null, 2));
    adapter.files.set(MACHINE_LIBRARY_PATH, JSON.stringify({
      format: 'wire-edm-machine-library', schemaVersion: 1, machines: []
    }, null, 2));

    const reopened = await initializeWorkbenchCatalog(adapter);
    if (!reopened.ok) throw new Error(JSON.stringify(reopened.error));

    expect(reopened).toMatchObject({
      ok: true,
      kind: 'opened',
      workbench: { manifest: { schemaVersion: 3 }, posts: { installations: [] }, machines: { machines: [] } }
    });
    expect(JSON.parse(adapter.files.get(projectPath) ?? '{}')).toMatchObject({
      format: 'wire-edm-project', schemaVersion: 2, id: 'interrupted'
    });
  });

  it('migrates a valid version-2 manifest by removing legacy export preferences', async () => {
    const adapter = new MemoryAdapter('Legacy workbench');
    const created = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-08-28T12:00:00.000Z')
    });
    if (!created.ok) throw new Error(created.error.message);
    adapter.files.set(WORKBENCH_CATALOG_PATH, JSON.stringify({
      ...created.workbench.manifest,
      schemaVersion: 2,
      preferences: {
        ...created.workbench.manifest.preferences,
        export: {
          status: 'configured',
          fileExtension: { kind: 'custom', extension: 'tap' },
          lineEnding: 'lf'
        }
      }
    }));

    const reopened = await initializeWorkbenchCatalog(adapter);

    expect(reopened).toMatchObject({
      ok: true,
      kind: 'opened',
      workbench: {
        manifest: {
          schemaVersion: 3,
          preferences: {
            importUnits: { mode: 'ask' },
            recentPlanningMachineId: null
          }
        }
      }
    });
    expect(JSON.parse(adapter.files.get(WORKBENCH_CATALOG_PATH) ?? '')).not.toHaveProperty('preferences.export');
    expect(JSON.parse(adapter.files.get('legacy/v2/workbench.json') ?? '')).toMatchObject({
      schemaVersion: 2,
      preferences: { export: { fileExtension: { extension: 'tap' } } }
    });
  });

  it('leaves an invalid version-2 workbench byte-for-byte unchanged', async () => {
    const { adapter } = await legacyV2Fixture();
    const manifest = JSON.parse(adapter.files.get(WORKBENCH_CATALOG_PATH)!);
    manifest.projects = [{ id: 'missing', name: 'Missing', path: 'projects/missing.json', sourceKind: 'upid', updatedAt: manifest.updatedAt }];
    adapter.files.set(WORKBENCH_CATALOG_PATH, JSON.stringify(manifest));
    const before = new Map(adapter.files);
    expect(await initializeWorkbenchCatalog(adapter)).toMatchObject({
      ok: false, error: { code: 'WORKBENCH_CATALOG_PROJECT_DANGLING' }
    });
    expect(adapter.files).toEqual(before);
  });

  it.each(['quota', 'corrupt-backup', 'conflicting-backup'] as const)(
    'does not replace a version-2 manifest when backup protection fails: %s', async (failure) => {
      const { adapter, original } = await legacyV2Fixture();
      const path = 'legacy/v2/workbench.json';
      if (failure === 'conflicting-backup') adapter.files.set(path, 'OTHER WORKBENCH');
      else {
        const write = adapter.writeText.bind(adapter);
        vi.spyOn(adapter, 'writeText').mockImplementation(async (target, contents) => {
          if (target === path && failure === 'quota') throw new Error('Quota exceeded');
          return write(target, target === path ? 'TRUNCATED' : contents);
        });
      }
      expect(await initializeWorkbenchCatalog(adapter)).toMatchObject({ ok: false });
      expect(adapter.files.get(WORKBENCH_CATALOG_PATH)).toBe(original);
      if (failure === 'conflicting-backup') expect(adapter.files.get(path)).toBe('OTHER WORKBENCH');
    }
  );

  it('resumes an interrupted version-2 upgrade from its exact backup and preserves it on later opens', async () => {
    const { adapter, original } = await legacyV2Fixture();
    const write = adapter.writeText.bind(adapter);
    vi.spyOn(adapter, 'writeText').mockImplementation(async (path, contents) => {
      if (path === WORKBENCH_CATALOG_PATH) throw new Error('Interrupted before manifest replacement');
      return write(path, contents);
    });
    expect(await initializeWorkbenchCatalog(adapter)).toMatchObject({ ok: false });
    expect(adapter.files.get(WORKBENCH_CATALOG_PATH)).toBe(original);
    expect(adapter.files.get('legacy/v2/workbench.json')).toBe(original);
    vi.mocked(adapter.writeText).mockRestore();
    expect(await initializeWorkbenchCatalog(adapter)).toMatchObject({ ok: true });
    const upgraded = new Map(adapter.files);
    expect(await initializeWorkbenchCatalog(adapter)).toMatchObject({ ok: true });
    expect(adapter.files).toEqual(upgraded);
    expect(adapter.files.get('legacy/v2/workbench.json')).toBe(original);
  });

  it('validates version-1 project ownership before rewriting any files', async () => {
    const adapter = new MemoryAdapter();
    const timestamp = '2026-08-28T12:00:00.000Z';
    adapter.files.set('projects/legacy.json', JSON.stringify({
      schemaVersion: 1, id: 'legacy', name: 'Actual name', createdAt: timestamp, updatedAt: timestamp,
      source: { kind: 'upid', files: [] },
      upid: { format: 'upid', schemaVersion: 1, document: createUpidFromDxfEntities([]) },
      machine: { id: 'legacy-profile' }, editor: { activeFilePath: null, pinnedLineNumbers: [] }
    }));
    adapter.files.set(WORKBENCH_CATALOG_PATH, JSON.stringify({
      schemaVersion: 1, name: 'Legacy', createdAt: timestamp, updatedAt: timestamp,
      templates: {}, output: {}, activeMachineProfileId: 'legacy-profile', machineProfiles: [],
      projects: [{ id: 'legacy', name: 'Wrong name', path: 'projects/legacy.json', sourceKind: 'upid', updatedAt: timestamp }]
    }));
    const before = new Map(adapter.files);
    expect(await initializeWorkbenchCatalog(adapter)).toMatchObject({
      ok: false, error: { code: 'WORKBENCH_CATALOG_PROJECT_INDEX_MISMATCH' }
    });
    expect(adapter.files).toEqual(before);
  });

  it('rejects a remembered planning machine that does not exist instead of selecting another', async () => {
    const adapter = new MemoryAdapter();
    const created = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-08-28T12:00:00.000Z')
    });
    if (!created.ok) throw new Error(created.error.message);
    adapter.files.set(WORKBENCH_CATALOG_PATH, JSON.stringify({
      ...created.workbench.manifest,
      preferences: {
        ...created.workbench.manifest.preferences,
        recentPlanningMachineId: 'missing.machine'
      }
    }));

    expect(await initializeWorkbenchCatalog(adapter)).toMatchObject({
      ok: false,
      error: {
        code: 'WORKBENCH_CATALOG_MACHINE_NOT_FOUND',
        path: '/preferences/recentPlanningMachineId',
        machineId: 'missing.machine'
      }
    });
  });

  it('rolls back companion files when initial manifest creation fails', async () => {
    const adapter = new MemoryAdapter('catalog-test', true);

    expect(await initializeWorkbenchCatalog(adapter)).toMatchObject({
      ok: false,
      error: { code: 'WORKBENCH_CATALOG_ACCESS_FAILED', operation: 'write' }
    });
    expect(adapter.files.has(POST_LIBRARY_PATH)).toBe(false);
    expect(adapter.files.has(MACHINE_LIBRARY_PATH)).toBe(false);
    expect(await initializeWorkbenchCatalog(adapter)).toMatchObject({ ok: true, kind: 'created' });
  });

  it('rejects a dangling project index entry while opening the catalog', async () => {
    const adapter = new MemoryAdapter();
    const created = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-08-28T12:00:00.000Z')
    });
    if (!created.ok) throw new Error(created.error.message);
    adapter.files.set(WORKBENCH_CATALOG_PATH, JSON.stringify({
      ...created.workbench.manifest,
      projects: [{
        id: 'missing',
        name: 'Missing',
        path: 'projects/missing.json',
        sourceKind: 'upid',
        updatedAt: '2026-08-28T12:00:00.000Z'
      }]
    }));

    expect(await initializeWorkbenchCatalog(adapter)).toMatchObject({
      ok: false,
      error: {
        code: 'WORKBENCH_CATALOG_PROJECT_DANGLING',
        projectId: 'missing',
        path: 'projects/missing.json'
      }
    });
  });

  it('rejects a manifest index field that disagrees with its stored project', async () => {
    const adapter = new MemoryAdapter();
    const created = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-08-28T12:00:00.000Z')
    });
    if (!created.ok) throw new Error(created.error.message);
    const project = projectFixture();
    const added = await addStoredWorkbenchProject(created.workbench, { project, ownedFiles: [] });
    if (!added.ok) throw new Error(added.error.message);
    adapter.files.set(WORKBENCH_CATALOG_PATH, JSON.stringify({
      ...added.workbench.manifest,
      projects: added.workbench.manifest.projects.map((entry) => ({ ...entry, name: 'Tampered' }))
    }));

    expect(await initializeWorkbenchCatalog(adapter)).toMatchObject({
      ok: false,
      error: {
        code: 'WORKBENCH_CATALOG_PROJECT_INDEX_MISMATCH',
        projectId: 'fixture',
        field: 'name',
        expected: 'Tampered',
        actual: 'Fixture'
      }
    });
  });

  it('rejects an indexed project whose declared owned source is missing', async () => {
    const adapter = new MemoryAdapter();
    const created = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-08-28T12:00:00.000Z')
    });
    if (!created.ok) throw new Error(created.error.message);
    const project = projectWithSourceFixture();
    const added = await addStoredWorkbenchProject(created.workbench, {
      project,
      ownedFiles: [{ path: 'imports/fixture.upid', contents: 'SOURCE' }]
    });
    if (!added.ok) throw new Error(added.error.message);
    adapter.files.delete('imports/fixture.upid');

    expect(await initializeWorkbenchCatalog(adapter)).toMatchObject({
      ok: false,
      error: {
        code: 'WORKBENCH_CATALOG_PROJECT_SOURCE_DANGLING',
        projectId: 'sourced',
        path: 'imports/fixture.upid'
      }
    });
  });

  it('rejects source, document, and revision path ownership shared across projects', async () => {
    const adapter = new MemoryAdapter();
    const created = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-08-28T12:00:00.000Z')
    });
    if (!created.ok) throw new Error(created.error.message);
    const firstProject = projectWithSourceFixture('first', 'imports/shared.upid');
    const first = await addStoredWorkbenchProject(created.workbench, {
      project: firstProject,
      ownedFiles: [{ path: 'imports/shared.upid', contents: 'SOURCE' }]
    });
    if (!first.ok) throw new Error(first.error.message);
    const secondProject = projectWithSourceFixture('second', 'imports/shared.upid');
    adapter.files.set('projects/second.json', `${JSON.stringify(secondProject, null, 2)}\n`);
    adapter.files.set(WORKBENCH_CATALOG_PATH, JSON.stringify({
      ...first.workbench.manifest,
      projects: [...first.workbench.manifest.projects, {
        id: secondProject.id,
        name: secondProject.name,
        path: 'projects/second.json',
        sourceKind: secondProject.source.kind,
        updatedAt: secondProject.updatedAt
      }]
    }));

    expect(await initializeWorkbenchCatalog(adapter)).toMatchObject({
      ok: false,
      error: {
        code: 'WORKBENCH_CATALOG_PROJECT_PATH_COLLISION',
        path: 'imports/shared.upid',
        firstProjectId: 'first',
        secondProjectId: 'second'
      }
    });
  });

  it('rejects an indexed saved revision whose exact file is missing', async () => {
    const adapter = new MemoryAdapter();
    const created = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-08-28T12:00:00.000Z')
    });
    if (!created.ok) throw new Error(created.error.message);
    const added = await addStoredWorkbenchProject(created.workbench, {
      project: projectFixture(),
      ownedFiles: []
    });
    if (!added.ok) throw new Error(added.error.message);
    const updatedAt = '2026-08-28T13:00:00.000Z';
    const storedProject = JSON.parse(adapter.files.get('projects/fixture.json') ?? '');
    storedProject.savedRevisionIds = ['revision.0001'];
    storedProject.updatedAt = updatedAt;
    adapter.files.set('projects/fixture.json', JSON.stringify(storedProject));
    adapter.files.set(WORKBENCH_CATALOG_PATH, JSON.stringify({
      ...added.workbench.manifest,
      updatedAt,
      projects: added.workbench.manifest.projects.map((entry) => ({ ...entry, updatedAt }))
    }));

    expect(await initializeWorkbenchCatalog(adapter)).toMatchObject({
      ok: false,
      error: {
        code: 'WORKBENCH_CATALOG_PROJECT_REVISION_DANGLING',
        projectId: 'fixture',
        revisionId: 'revision.0001',
        path: 'projects/fixture/revisions/revision.0001.wireedm-job.json'
      }
    });
  });
});

function projectFixture() {
  const created = createWorkbenchProjectDocument({
    id: 'fixture',
    name: 'Fixture',
    now: new Date('2026-08-28T12:00:00.000Z'),
    source: { kind: 'upid', files: [] },
    content: {
      kind: 'upid-document',
      document: createUpidFromDxfEntities([
        { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }
      ])
    }
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.project;
}

async function legacyV2Fixture() {
  const adapter = new MemoryAdapter();
  const created = await initializeWorkbenchCatalog(adapter);
  if (!created.ok) throw new Error(created.error.message);
  const original = JSON.stringify({
    ...created.workbench.manifest, schemaVersion: 2,
    preferences: { ...created.workbench.manifest.preferences, export: { status: 'unconfigured' } }
  });
  adapter.files.set(WORKBENCH_CATALOG_PATH, original);
  return { adapter, original };
}

function projectWithSourceFixture(id = 'sourced', sourcePath = 'imports/fixture.upid') {
  const created = createWorkbenchProjectDocument({
    id,
    name: id,
    now: new Date('2026-08-28T12:00:00.000Z'),
    source: {
      kind: 'upid',
      files: [{
        kind: 'upid',
        name: 'fixture.upid',
        path: sourcePath,
        createdAt: '2026-08-28T12:00:00.000Z'
      }]
    },
    content: {
      kind: 'upid-document',
      document: createUpidFromDxfEntities([
        { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }
      ])
    }
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.project;
}
