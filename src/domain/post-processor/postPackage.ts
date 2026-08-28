import { Value } from '@sinclair/typebox/value';

import {
  WireEdmPostPackageSchema,
  type DeepReadonly,
  type WireEdmPostPackage,
  type WireEdmPostPackageValue
} from './postPackageSchema';
import { POST_IDENTIFIER_PATTERN } from './postFormatPrimitives';
import {
  collectPostPropertyIssues,
  propertyValueDiagnostic
} from './postProperties';

const MAX_PACKAGE_BYTES = 1024 * 1024;
const postIdentifier = new RegExp(POST_IDENTIFIER_PATTERN);

export type PostPackageDiagnosticCode =
  | 'POST_PACKAGE_FILE_TOO_LARGE'
  | 'POST_PACKAGE_JSON_INVALID'
  | 'POST_PACKAGE_SCHEMA_INVALID'
  | 'POST_PACKAGE_RECORD_KEY_INVALID'
  | 'POST_PACKAGE_DUPLICATE_ID'
  | 'POST_PACKAGE_SOURCE_NOT_FOUND'
  | 'POST_PACKAGE_EVIDENCE_NOT_FOUND'
  | 'POST_PACKAGE_EVIDENCE_TARGET_NOT_FOUND'
  | 'POST_PACKAGE_EVIDENCE_SCOPE_MISMATCH'
  | 'POST_PACKAGE_EXECUTION_CONTRACT_INVALID'
  | 'POST_PACKAGE_PROPERTY_DEFINITION_INVALID'
  | 'POST_PACKAGE_FIXTURE_PROPERTY_INVALID';

export interface PostPackageDiagnostic {
  code: PostPackageDiagnosticCode;
  path: string;
  message: string;
}

export type PostPackageParseResult =
  | { ok: true; package: WireEdmPostPackage }
  | { ok: false; diagnostics: readonly PostPackageDiagnostic[] };

export function parseWireEdmPostPackage(rawText: string): PostPackageParseResult {
  if (new TextEncoder().encode(rawText).byteLength > MAX_PACKAGE_BYTES) {
    return failure({
      code: 'POST_PACKAGE_FILE_TOO_LARGE',
      path: '',
      message: 'Post package exceeds the 1 MiB UTF-8 size limit.'
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return failure({
      code: 'POST_PACKAGE_JSON_INVALID',
      path: '',
      message: 'Post package is not valid JSON.'
    });
  }

  return validateWireEdmPostPackageValue(parsed);
}

export function validateWireEdmPostPackageValue(value: unknown): PostPackageParseResult {
  const schemaDiagnostics = [...Value.Errors(WireEdmPostPackageSchema, value)].map((error) => ({
    code: 'POST_PACKAGE_SCHEMA_INVALID' as const,
    path: error.path,
    message: `Post package schema violation at ${error.path || '/'}: ${error.message}.`
  }));
  if (schemaDiagnostics.length > 0) return { ok: false, diagnostics: schemaDiagnostics };

  const packageValue = value as WireEdmPostPackageValue;
  const semanticDiagnostics = validatePackageSemantics(packageValue);
  if (semanticDiagnostics.length > 0) return { ok: false, diagnostics: semanticDiagnostics };

  return { ok: true, package: deepFreeze(packageValue) };
}

function validatePackageSemantics(packageValue: WireEdmPostPackageValue) {
  const diagnostics: PostPackageDiagnostic[] = [];
  appendRecordKeyDiagnostics(diagnostics, packageValue.manifest.properties, '/manifest/properties');
  appendRecordKeyDiagnostics(diagnostics, packageValue.dialect.commands, '/dialect/commands');
  for (const [commandName, command] of Object.entries(packageValue.dialect.commands)) {
    appendRecordKeyDiagnostics(
      diagnostics,
      command.parameters,
      `/dialect/commands/${escapeJsonPointer(commandName)}/parameters`
    );
  }
  for (const [fixtureIndex, fixture] of packageValue.fixtures.entries()) {
    appendRecordKeyDiagnostics(diagnostics, fixture.properties, `/fixtures/${fixtureIndex}/properties`);
  }
  appendDuplicateIdDiagnostics(diagnostics, packageValue.sources, '/sources');
  appendDuplicateIdDiagnostics(diagnostics, packageValue.evidence, '/evidence');
  appendDuplicateIdDiagnostics(diagnostics, packageValue.fixtures, '/fixtures');
  appendExecutionContractDiagnostics(diagnostics, packageValue);

  const sourceIds = new Set(packageValue.sources.map(({ id }) => id));
  for (const [evidenceIndex, evidence] of packageValue.evidence.entries()) {
    if (sourceIds.has(evidence.sourceRef)) continue;
    diagnostics.push({
      code: 'POST_PACKAGE_SOURCE_NOT_FOUND',
      path: `/evidence/${evidenceIndex}/sourceRef`,
      message: `Source reference ${evidence.sourceRef} does not name an entry in /sources.`
    });
  }

  const evidenceIds = new Set(packageValue.evidence.map(({ id }) => id));
  const evidenceById = new Map(packageValue.evidence.map((evidence) => [evidence.id, evidence]));
  const commandIds = new Set(Object.keys(packageValue.dialect.commands));
  for (const [evidenceIndex, evidence] of packageValue.evidence.entries()) {
    for (const [supportIndex, support] of evidence.supports.entries()) {
      if (commandIds.has(support.id)) continue;
      diagnostics.push({
        code: 'POST_PACKAGE_EVIDENCE_TARGET_NOT_FOUND',
        path: `/evidence/${evidenceIndex}/supports/${supportIndex}/id`,
        message: `Evidence target ${support.kind}:${support.id} does not name a declared command.`
      });
    }
  }
  for (const [commandName, command] of Object.entries(packageValue.dialect.commands)) {
    appendEvidenceDiagnostics(
      diagnostics,
      evidenceIds,
      command.evidenceRefs,
      `/dialect/commands/${escapeJsonPointer(commandName)}/evidenceRefs`
    );
    for (const [referenceIndex, evidenceRef] of command.evidenceRefs.entries()) {
      const evidence = evidenceById.get(evidenceRef);
      if (!evidence || evidence.supports.some((support) => (
        support.kind === 'command' && support.id === commandName
      ))) {
        continue;
      }
      diagnostics.push({
        code: 'POST_PACKAGE_EVIDENCE_SCOPE_MISMATCH',
        path: `/dialect/commands/${escapeJsonPointer(commandName)}/evidenceRefs/${referenceIndex}`,
        message: `Evidence ${evidenceRef} does not declare support for command ${commandName}.`
      });
    }
  }

  for (const [propertyName, definition] of Object.entries(packageValue.manifest.properties)) {
    const definitionMessage = propertyDefinitionMessage(propertyName, definition);
    if (definitionMessage) {
      diagnostics.push({
        code: 'POST_PACKAGE_PROPERTY_DEFINITION_INVALID',
        path: `/manifest/properties/${escapeJsonPointer(propertyName)}`,
        message: definitionMessage
      });
    }
  }

  for (const [fixtureIndex, fixture] of packageValue.fixtures.entries()) {
    appendEvidenceDiagnostics(
      diagnostics,
      evidenceIds,
      fixture.evidenceRefs,
      `/fixtures/${fixtureIndex}/evidenceRefs`
    );
    const propertyIssues = collectPostPropertyIssues(
      packageValue.manifest.properties,
      fixture.properties,
      `${packageValue.manifest.id}@${packageValue.manifest.version}`
    );
    for (const issue of propertyIssues) {
      diagnostics.push({
        code: 'POST_PACKAGE_FIXTURE_PROPERTY_INVALID',
        path: `/fixtures/${fixtureIndex}/properties/${escapeJsonPointer(issue.propertyName)}`,
        message: issue.kind === 'required'
          ? `Required property ${issue.propertyName} is missing from fixture ${fixture.id}.`
          : issue.message
      });
    }
  }

  return diagnostics;
}

function appendExecutionContractDiagnostics(
  diagnostics: PostPackageDiagnostic[],
  packageValue: WireEdmPostPackageValue
) {
  const { capabilities, execution } = packageValue.manifest;
  const compensationDeclared = capabilities.controllerCompensation === 'left-right';
  const lifecycleDeclared = execution.compensationLifecycle !== 'none';
  if (compensationDeclared !== lifecycleDeclared) {
    diagnostics.push({
      code: 'POST_PACKAGE_EXECUTION_CONTRACT_INVALID',
      path: '/manifest/execution/compensationLifecycle',
      message: 'The compensation lifecycle and controllerCompensation capability must either both be enabled or both be disabled.'
    });
  }
  if (execution.compensationRequiredForEveryOperation && !lifecycleDeclared) {
    diagnostics.push({
      code: 'POST_PACKAGE_EXECUTION_CONTRACT_INVALID',
      path: '/manifest/execution/compensationRequiredForEveryOperation',
      message: 'Compensation cannot be required for every operation when compensationLifecycle is none.'
    });
  }
  if (
    execution.compensationLifecycle === 'controller-native-program' &&
    capabilities.operations !== 'single'
  ) {
    diagnostics.push({
      code: 'POST_PACKAGE_EXECUTION_CONTRACT_INVALID',
      path: '/manifest/capabilities/operations',
      message: 'A program-scoped native compensation lifecycle must declare single-operation capability.'
    });
  }
  if (!capabilities.initialWirePosition) {
    diagnostics.push({
      code: 'POST_PACKAGE_EXECUTION_CONTRACT_INVALID',
      path: '/manifest/capabilities/initialWirePosition',
      message: 'Engine API v1 requires every post to consume the explicit initial wire position.'
    });
  }
}

function appendRecordKeyDiagnostics(
  diagnostics: PostPackageDiagnostic[],
  record: Readonly<Record<string, unknown>>,
  path: string
) {
  for (const key of Object.keys(record)) {
    if (postIdentifier.test(key)) continue;
    diagnostics.push({
      code: 'POST_PACKAGE_RECORD_KEY_INVALID',
      path: `${path}/${escapeJsonPointer(key)}`,
      message: `Record key ${JSON.stringify(key)} must match ${POST_IDENTIFIER_PATTERN}.`
    });
  }
}

function propertyDefinitionMessage(
  propertyName: string,
  definition: WireEdmPostPackageValue['manifest']['properties'][string]
) {
  if ('minimum' in definition && 'maximum' in definition) {
    if (
      definition.minimum !== undefined &&
      definition.maximum !== undefined &&
      definition.minimum > definition.maximum
    ) {
      return `Property ${propertyName} has a minimum greater than its maximum.`;
    }
  }
  if (definition.type === 'string') {
    if (
      definition.minLength !== undefined &&
      definition.maxLength !== undefined &&
      definition.minLength > definition.maxLength
    ) {
      return `Property ${propertyName} has a minimum length greater than its maximum length.`;
    }
  }
  if (definition.suggestedValue !== undefined) {
    return propertyValueDiagnostic(propertyName, definition, definition.suggestedValue);
  }
  return null;
}

function appendDuplicateIdDiagnostics(
  diagnostics: PostPackageDiagnostic[],
  values: readonly { id: string }[],
  path: string
) {
  const firstIndexById = new Map<string, number>();
  for (const [index, value] of values.entries()) {
    const firstIndex = firstIndexById.get(value.id);
    if (firstIndex === undefined) {
      firstIndexById.set(value.id, index);
      continue;
    }
    diagnostics.push({
      code: 'POST_PACKAGE_DUPLICATE_ID',
      path: `${path}/${index}/id`,
      message: `Duplicate ID ${value.id}; it was first declared at ${path}/${firstIndex}/id.`
    });
  }
}

function appendEvidenceDiagnostics(
  diagnostics: PostPackageDiagnostic[],
  evidenceIds: ReadonlySet<string>,
  references: readonly string[],
  path: string
) {
  for (const [index, evidenceRef] of references.entries()) {
    if (evidenceIds.has(evidenceRef)) continue;
    diagnostics.push({
      code: 'POST_PACKAGE_EVIDENCE_NOT_FOUND',
      path: `${path}/${index}`,
      message: `Evidence reference ${evidenceRef} does not name an entry in /evidence.`
    });
  }
}

function escapeJsonPointer(value: string) {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function failure(diagnostic: PostPackageDiagnostic): PostPackageParseResult {
  return { ok: false, diagnostics: [diagnostic] };
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
