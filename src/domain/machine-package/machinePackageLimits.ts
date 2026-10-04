/** Shared input limits must not load archive validation or post execution. */
export const MACHINE_PACKAGE_ENTRY = 'wireedm-package.json';
export const MACHINE_PACKAGE_SCHEMA_VERSION = 1 as const;
export const MAX_MACHINE_PACKAGE_ARCHIVE_BYTES = 32 * 1024 * 1024;
export const MAX_MACHINE_PACKAGE_EXPANDED_BYTES = 64 * 1024 * 1024;
export const MAX_MACHINE_PACKAGE_ENTRIES = 2_048;
