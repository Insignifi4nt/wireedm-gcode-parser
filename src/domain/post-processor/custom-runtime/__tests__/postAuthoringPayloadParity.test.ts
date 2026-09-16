import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

describe('published post event payloads', () => {
  it('publishes every runtime event field, including optional payload fields', () => {
    const runtime = eventPayloads('src/domain/execution-plan/executionPlan.ts', 'WireEdmExecutionEvent');
    const sdk = eventPayloads('docs/post-authoring/v1/sdk/wire-edm-post-sdk.d.ts', 'WireEdmPostEvent');
    expect(sdk).toEqual(runtime);
    expect(sdk.get('position')).toContain('separatesWire?');
  });
});

function eventPayloads(path: string, typeName: string) {
  const source = ts.createSourceFile(path, readFileSync(resolve(process.cwd(), path), 'utf8'),
    ts.ScriptTarget.Latest, true);
  const alias = source.statements.find((statement): statement is ts.TypeAliasDeclaration =>
    ts.isTypeAliasDeclaration(statement) && statement.name.text === typeName);
  if (!alias || !ts.isUnionTypeNode(alias.type)) throw new Error(`Missing union ${typeName}`);
  const payloads = new Map<string, string[]>();
  for (const branch of alias.type.types) {
    const unwrapped = ts.isParenthesizedTypeNode(branch) ? branch.type : branch;
    const payload = ts.isIntersectionTypeNode(unwrapped)
      ? unwrapped.types.find(ts.isTypeLiteralNode) : null;
    if (!payload) throw new Error(`Missing payload in ${typeName}`);
    const fields = payload.members.filter(ts.isPropertySignature);
    const kind = fields.find((field) => field.name?.getText(source) === 'kind');
    if (!kind?.type || !ts.isLiteralTypeNode(kind.type) || !ts.isStringLiteral(kind.type.literal)) {
      throw new Error(`Missing event kind in ${typeName}`);
    }
    payloads.set(kind.type.literal.text, fields.filter((field) => field !== kind)
      .map((field) => `${field.name?.getText(source)}${field.questionToken ? '?' : ''}`).sort());
  }
  return payloads;
}
