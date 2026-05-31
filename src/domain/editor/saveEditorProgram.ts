import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';
import {
  WORKBENCH_MANIFEST_FILE,
  type WorkbenchManifest
} from '@/domain/storage/workbenchStorage';
import { postPathPlanToGcode } from '@/domain/path-intel/postGcode';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import type { WorkbenchProject } from '@/domain/workbench/types';

import { parseGCodeProgram } from './gcodeParser';
import { organizeGCodeStructure } from './gcodeStructure';
import type { LoadedEditorProgram } from './loadEditorProgram';

export interface SaveEditorProgramInput {
  filePath: string;
  now?: Date;
  pathDocument?: PathPlanningDocument | null;
  project?: WorkbenchProject;
  text: string;
}

export interface SaveEditorProgramResult {
  editorProgram: LoadedEditorProgram;
  workbench: ConnectedWorkbench;
}

export async function saveEditorProgram(
  workbench: ConnectedWorkbench,
  input: SaveEditorProgramInput
): Promise<SaveEditorProgramResult> {
  const existingText = await workbench.adapter.readText(input.filePath);
  if (existingText === null) {
    throw new Error(`Editor program file not found: ${input.filePath}`);
  }

  await workbench.adapter.writeText(input.filePath, input.text);

  const projectSave = await saveProjectPathState(workbench, input);
  const updatedWorkbench = projectSave?.workbench ?? workbench;
  const updatedProject = projectSave?.project ?? input.project;

  return {
    workbench: updatedWorkbench,
    editorProgram: {
      filePath: input.filePath,
      text: input.text,
      parseResult: parseGCodeProgram(input.text),
      project: updatedProject
    }
  };
}

async function saveProjectPathState(
  workbench: ConnectedWorkbench,
  input: SaveEditorProgramInput
) {
  if (!input.project || !Object.hasOwn(input, 'pathDocument')) return null;

  const timestamp = (input.now ?? new Date()).toISOString();
  const projectEntry = workbench.manifest.projects.find((entry) => entry.id === input.project?.id);
  if (!projectEntry) {
    throw new Error(`Project index entry not found: ${input.project.id}`);
  }

  const nextProject: WorkbenchProject = {
    ...input.project,
    updatedAt: timestamp,
    generated: {
      ...input.project.generated,
      body: bodyTextFromProgram(input.text, input.project)
    }
  };

  const bodyFile = nextProject.generated.files.find((file) => file.path.endsWith('.body.gcode'));

  if (input.pathDocument) {
    const post = postPathPlanToGcode(
      input.pathDocument.plan,
      input.pathDocument.segments,
      input.pathDocument.options
    );
    nextProject.generated.body = post.body;
    nextProject.pathPlanning = {
      document: input.pathDocument,
      postDiagnostics: post.diagnostics
    };
    if (bodyFile) {
      await workbench.adapter.writeText(bodyFile.path, post.body);
    }
  } else {
    delete nextProject.pathPlanning;
    if (bodyFile) {
      await workbench.adapter.writeText(bodyFile.path, nextProject.generated.body);
    }
  }

  await workbench.adapter.writeText(projectEntry.path, JSON.stringify(nextProject, null, 2));

  const updatedManifest: WorkbenchManifest = {
    ...workbench.manifest,
    updatedAt: timestamp,
    projects: workbench.manifest.projects.map((entry) =>
      entry.id === nextProject.id
        ? {
            ...entry,
            name: nextProject.name,
            sourceKind: nextProject.source.kind,
            updatedAt: timestamp
          }
        : entry
    )
  };

  await workbench.adapter.writeText(
    WORKBENCH_MANIFEST_FILE,
    JSON.stringify(updatedManifest, null, 2)
  );

  return {
    project: nextProject,
    workbench: {
      ...workbench,
      manifest: updatedManifest
    }
  };
}

function bodyTextFromProgram(text: string, project: WorkbenchProject) {
  const templateBody = bodyTextBetweenProjectTemplates(text, project);
  if (templateBody !== null) return templateBody;

  const structure = organizeGCodeStructure(text.split(/\r?\n/));
  return structure.body.lines.map((line) => line.text).join('\n');
}

function bodyTextBetweenProjectTemplates(text: string, project: WorkbenchProject) {
  const lines = text.split(/\r?\n/);
  const headerLines = project.machine.templates.header.split(/\r?\n/);
  const footerLines = project.machine.templates.footer.split(/\r?\n/);
  const footerStart = findLastLineSequence(lines, footerLines);
  if (footerStart < 0) return null;

  const bodyStart = linesMatchAt(lines, headerLines, 0)
    ? headerLines.length
    : firstStructuredBodyLineIndex(text);
  if (bodyStart === null) return null;
  if (footerStart < bodyStart) return null;

  return lines.slice(bodyStart, footerStart).join('\n');
}

function firstStructuredBodyLineIndex(text: string) {
  const structure = organizeGCodeStructure(text.split(/\r?\n/));
  const firstBodyLine = structure.body.lines[0]?.num;
  return firstBodyLine ? firstBodyLine - 1 : null;
}

function findLastLineSequence(lines: string[], sequence: string[]) {
  if (sequence.length === 0 || sequence.length > lines.length) return -1;

  for (let index = lines.length - sequence.length; index >= 0; index--) {
    if (linesMatchAt(lines, sequence, index)) return index;
  }

  return -1;
}

function linesMatchAt(lines: string[], sequence: string[], startIndex: number) {
  return sequence.every((line, index) => lines[startIndex + index] === line);
}
