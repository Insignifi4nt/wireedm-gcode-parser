interface BaseNameOptions {
  fallback: string;
  stripExtension: RegExp;
}

export function baseNameFromFileName(fileName: string, options: BaseNameOptions) {
  const withoutPath = fileName.split(/[\\/]/).pop() || options.fallback;
  return withoutPath.replace(options.stripExtension, '').trim() || options.fallback;
}

export function uniqueProjectId(baseId: string, existingIds: string[]) {
  const existing = new Set(existingIds);
  if (!existing.has(baseId)) return baseId;

  for (let suffix = 2; suffix < Number.MAX_SAFE_INTEGER; suffix++) {
    const candidate = `${baseId}-${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }

  throw new Error('Could not create a unique project ID.');
}
