import { baseNameFromFileName, uniqueProjectId } from '@/domain/workbench/projectNaming';

export function importedProjectIdentity(input: {
  readonly fileName: string;
  readonly fallbackName: string;
  readonly stripExtension: RegExp;
  readonly timestamp: string;
  readonly existingIds: readonly string[];
}) {
  const name = baseNameFromFileName(input.fileName, {
    fallback: input.fallbackName,
    stripExtension: input.stripExtension
  });
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  const baseId = `${slug || 'wire-edm-project'}-${input.timestamp.slice(0, 10)}`;
  return {
    id: uniqueProjectId(baseId, [...input.existingIds]),
    name
  };
}
