export const MAX_PROJECT_NAME_LENGTH = 160;

export function projectNameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > MAX_PROJECT_NAME_LENGTH) {
    return `Project name must contain 1 to ${MAX_PROJECT_NAME_LENGTH} characters after trimming.`;
  }
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(name)) {
    return 'Project name must be a single line without control characters.';
  }
  return null;
}
