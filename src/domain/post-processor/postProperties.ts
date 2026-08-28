import type {
  PostPropertyDefinition,
  WireEdmPostPackage
} from './postPackageSchema';

export type PostPropertyValue = boolean | number | string;

export interface PostPropertyDiagnostic {
  code: 'POST_PROPERTY_VALUE_INVALID' | 'POST_PROPERTY_UNKNOWN' | 'POST_PROPERTY_REQUIRED';
  path: string;
  message: string;
}

export type PostPropertyValidationResult =
  | { ok: true; values: Readonly<Record<string, PostPropertyValue>> }
  | { ok: false; diagnostics: readonly PostPropertyDiagnostic[] };

export interface PostPropertyIssue {
  kind: 'invalid' | 'unknown' | 'required';
  propertyName: string;
  message: string;
}

export function validatePostPropertyValues(
  packageValue: WireEdmPostPackage,
  values: Readonly<Record<string, unknown>>
): PostPropertyValidationResult {
  const issues = collectPostPropertyIssues(
    packageValue.manifest.properties,
    values,
    `${packageValue.manifest.id}@${packageValue.manifest.version}`
  );
  const diagnostics = issues.map((issue): PostPropertyDiagnostic => ({
    code: issue.kind === 'unknown'
      ? 'POST_PROPERTY_UNKNOWN'
      : issue.kind === 'required'
        ? 'POST_PROPERTY_REQUIRED'
        : 'POST_PROPERTY_VALUE_INVALID',
    path: `/${escapeJsonPointer(issue.propertyName)}`,
    message: issue.message
  }));

  if (diagnostics.length > 0) return { ok: false, diagnostics };
  const validatedValues: Record<string, PostPropertyValue> = {};
  for (const [propertyName, value] of Object.entries(values)) {
    if (isPostPropertyValue(value)) validatedValues[propertyName] = value;
  }
  return { ok: true, values: Object.freeze(validatedValues) };
}

export function collectPostPropertyIssues(
  definitions: WireEdmPostPackage['manifest']['properties'],
  values: Readonly<Record<string, unknown>>,
  packageLabel: string
): PostPropertyIssue[] {
  const issues: PostPropertyIssue[] = [];
  for (const [propertyName, value] of Object.entries(values)) {
    if (!Object.hasOwn(definitions, propertyName)) {
      issues.push({
        kind: 'unknown',
        propertyName,
        message: `Property ${propertyName} is not declared by ${packageLabel}.`
      });
      continue;
    }
    const definition = definitions[propertyName];
    const message = propertyValueDiagnostic(propertyName, definition, value);
    if (message) issues.push({ kind: 'invalid', propertyName, message });
  }
  for (const [propertyName, definition] of Object.entries(definitions)) {
    if (definition.required && !Object.hasOwn(values, propertyName)) {
      issues.push({
        kind: 'required',
        propertyName,
        message: `Required property ${propertyName} is missing.`
      });
    }
  }
  return issues;
}

export function propertyValueDiagnostic(
  propertyName: string,
  definition: PostPropertyDefinition,
  value: unknown
): string | null {
  switch (definition.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : `Property ${propertyName} must be a boolean.`;
    case 'integer':
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        return `Property ${propertyName} must be an integer${numericRange(definition)}.`;
      }
      return numberWithinBounds(value, definition)
        ? null
        : `Property ${propertyName} must be an integer${numericRange(definition)}.`;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return `Property ${propertyName} must be a finite number${numericRange(definition)}.`;
      }
      return numberWithinBounds(value, definition)
        ? null
        : `Property ${propertyName} must be a finite number${numericRange(definition)}.`;
    case 'string':
      if (typeof value !== 'string') return `Property ${propertyName} must be a string.`;
      if (definition.minLength !== undefined && value.length < definition.minLength) {
        return `Property ${propertyName} must contain at least ${definition.minLength} characters.`;
      }
      if (definition.maxLength !== undefined && value.length > definition.maxLength) {
        return `Property ${propertyName} must contain at most ${definition.maxLength} characters.`;
      }
      return null;
    case 'choice':
      return typeof value === 'string' && definition.choices.includes(value)
        ? null
        : `Property ${propertyName} must be one of: ${definition.choices.join(', ')}.`;
  }
}

function isPostPropertyValue(value: unknown): value is PostPropertyValue {
  return (
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function numberWithinBounds(
  value: number,
  definition: Extract<PostPropertyDefinition, { type: 'integer' | 'number' }>
) {
  return (
    (definition.minimum === undefined || value >= definition.minimum) &&
    (definition.maximum === undefined || value <= definition.maximum)
  );
}

function numericRange(
  definition: Extract<PostPropertyDefinition, { type: 'integer' | 'number' }>
) {
  if (definition.minimum !== undefined && definition.maximum !== undefined) {
    return ` between ${definition.minimum} and ${definition.maximum}`;
  }
  if (definition.minimum !== undefined) return ` greater than or equal to ${definition.minimum}`;
  if (definition.maximum !== undefined) return ` less than or equal to ${definition.maximum}`;
  return '';
}

function escapeJsonPointer(value: string) {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}
