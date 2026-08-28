import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { PostLibraryDocumentSchema } from '../src/domain/post-processor/postLibraryStorage.ts';
import { parseWireEdmPostPackage } from '../src/domain/post-processor/postPackage.ts';
import { WireEdmPostPackageSchema } from '../src/domain/post-processor/postPackageSchema.ts';
import { MachineDefinitionSchema } from '../src/domain/machine-definition/machineDefinition.ts';
import { MachineLibraryDocumentSchema } from '../src/domain/machine-definition/machineLibraryStorage.ts';
import { WorkbenchCatalogManifestSchema } from '../src/domain/workbench-catalog/workbenchCatalog.ts';
import { WorkbenchProjectDocumentSchema } from '../src/domain/workbench-catalog/workbenchProject.ts';
import { CUSTOM_POST_DIAGNOSTIC_CODES } from '../src/domain/post-processor/custom-runtime/customPostRuntime.ts';
import {
  CUSTOM_POST_EVENT_KINDS,
  CUSTOM_POST_SDK_DECLARATION
} from '../src/domain/post-processor/custom-runtime/postAuthoringContract.ts';

const root = process.cwd();
const examplePath = path.join(root, 'docs/post-authoring/v1/examples/minimal.wireedm-post.json');
const generatedFiles = [
  {
    path: path.join(root, 'docs/post-authoring/v1/schema/post-package.schema.json'),
    contents: `${JSON.stringify(WireEdmPostPackageSchema, null, 2)}\n`
  },
  {
    path: path.join(root, 'docs/post-authoring/v1/schema/post-library.schema.json'),
    contents: `${JSON.stringify(PostLibraryDocumentSchema, null, 2)}\n`
  },
  {
    path: path.join(root, 'docs/post-authoring/v1/schema/machine-definition.schema.json'),
    contents: `${JSON.stringify(MachineDefinitionSchema, null, 2)}\n`
  },
  {
    path: path.join(root, 'docs/post-authoring/v1/schema/machine-library.schema.json'),
    contents: `${JSON.stringify(MachineLibraryDocumentSchema, null, 2)}\n`
  },
  {
    path: path.join(root, 'docs/post-authoring/v1/schema/workbench.schema.json'),
    contents: `${JSON.stringify(WorkbenchCatalogManifestSchema, null, 2)}\n`
  },
  {
    path: path.join(root, 'docs/post-authoring/v1/schema/workbench-project.schema.json'),
    contents: `${JSON.stringify(WorkbenchProjectDocumentSchema, null, 2)}\n`
  },
  {
    path: path.join(root, 'docs/post-authoring/v1/sdk/wire-edm-post-sdk.d.ts'),
    contents: CUSTOM_POST_SDK_DECLARATION
  },
  {
    path: path.join(root, 'docs/post-authoring/v1/sdk/event-diagnostic-catalog.json'),
    contents: `${JSON.stringify({
      engineApiVersion: '1',
      eventKinds: CUSTOM_POST_EVENT_KINDS,
      runtimeDiagnosticCodes: CUSTOM_POST_DIAGNOSTIC_CODES
    }, null, 2)}\n`
  }
];

const example = parseWireEdmPostPackage(await readFile(examplePath, 'utf8'));
if (!example.ok) {
  throw new Error(`Minimal post example is invalid: ${JSON.stringify(example.diagnostics)}`);
}

if (process.argv.includes('--check')) {
  const stale: string[] = [];
  for (const file of generatedFiles) {
    const existing = await readExisting(file.path);
    if (existing !== file.contents) stale.push(path.relative(root, file.path));
  }
  if (stale.length > 0) {
    throw new Error(`Generated post-authoring files are stale: ${stale.join(', ')}. Run npm run post:docs:generate.`);
  }
} else {
  for (const file of generatedFiles) {
    await mkdir(path.dirname(file.path), { recursive: true });
    await writeFile(file.path, file.contents, 'utf8');
  }
}

async function readExisting(filePath: string) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
