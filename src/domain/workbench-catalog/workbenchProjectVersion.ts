import type { WorkbenchProjectDocument } from './workbenchProject';

/** Identifies the entire saved record, including its immutable revision references. */
export async function workbenchProjectVersion(project: WorkbenchProjectDocument): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(project)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
