import type { PackageAuthoringResult } from '@/domain/machine-package/packageAuthoringTools';
import { jsonByteLength, summarizeMessage } from '@/features/webmcp/diagnosticSummaries';

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Preserve receipts and actionable codes; the versioned report reader provides every original detail. */
export function packageReportSummary(value: PackageAuthoringResult) {
  const original = record(value.report.details);
  if (!original) return { ...value.report, details: null, detailsSummarized: true, fullReportAvailable: true };
  const details: Record<string, unknown> = {};
  const omittedDetailFields: string[] = [];
  function add(key: string, detail: unknown) {
    if (detail === undefined) return;
    if (jsonByteLength({ ...details, [key]: detail }) <= 24 * 1024) details[key] = detail;
    else omittedDetailFields.push(key);
  }
  // Exact hashes and references have priority over descriptive/report content.
  for (const key of ['archiveHash', 'post', 'activeBindingId', 'machine', 'structurallyValid', 'planningValid', 'verification', 'editableContents']) add(key, original[key]);
  const manifest = record(original.manifest);
  if (manifest) {
    const description = typeof manifest.description === 'string' ? summarizeMessage(manifest.description) : null;
    add('manifest', { id: manifest.id, name: manifest.name, version: manifest.version,
      ...(description ? { description: description.message, ...(description.messageTruncated ? { descriptionTruncated: true } : {}) } : {}) });
  }
  if (Array.isArray(original.diagnostics)) {
    const summary = rows(original.diagnostics, diagnosticSummary, 8 * 1024);
    add('diagnostics', summary.items);
    add('omittedDiagnosticCount', summary.omitted + (typeof original.omittedDiagnosticCount === 'number' ? original.omittedDiagnosticCount : 0));
  }
  const conformance = record(original.conformance);
  if (conformance) {
    const diagnostics = Array.isArray(conformance.diagnostics) ? rows(conformance.diagnostics, diagnosticSummary, 8 * 1024) : null;
    const fixtures = Array.isArray(conformance.fixtures) ? rows(conformance.fixtures, fixture => {
      const originalFixture = record(fixture);
      return { fixtureId: originalFixture?.fixtureId,
        ...(originalFixture && Object.keys(originalFixture).some(key => key !== 'fixtureId') ? { omittedDetails: true } : {}) };
    }, 4 * 1024) : null;
    add('conformance', { ok: conformance.ok,
      ...(diagnostics ? { diagnostics: diagnostics.items, omittedDiagnosticCount: diagnostics.omitted } : {}),
      ...(fixtures ? { fixtures: fixtures.items, omittedFixtureCount: fixtures.omitted } : {}) });
  }
  for (const [key, count, budget] of [['posts', 'omittedPostCount', 4 * 1024], ['evidencePaths', 'omittedEvidencePathCount', 4 * 1024]] as const) {
    if (!Array.isArray(original[key])) continue;
    const summary = rows(original[key], item => item, budget);
    add(key, summary.items); add(count, summary.omitted);
  }
  return { ...value.report, details, detailsSummarized: true, fullReportAvailable: true,
    ...(omittedDetailFields.length ? { omittedDetailFields } : {}) };
}

function rows(values: readonly unknown[], project: (value: unknown) => unknown, budget: number) {
  const items: unknown[] = [];
  let bytes = 2;
  for (const value of values.slice(0, 20)) {
    const item = project(value);
    const size = jsonByteLength(item) + (items.length ? 1 : 0);
    if (bytes + size > budget) break;
    items.push(item); bytes += size;
  }
  return { items, omitted: values.length - items.length };
}

function diagnosticSummary(value: unknown) {
  const diagnostic = record(value);
  if (!diagnostic) return { omittedDetails: true };
  const summary: Record<string, unknown> = {};
  for (const key of ['code', 'path', 'fixtureId']) if (key in diagnostic) summary[key] = diagnostic[key];
  if (typeof diagnostic.message === 'string') Object.assign(summary, summarizeMessage(diagnostic.message));
  if (Object.keys(diagnostic).some(key => !['code', 'path', 'fixtureId', 'message'].includes(key))) summary.omittedDetails = true;
  return summary;
}
