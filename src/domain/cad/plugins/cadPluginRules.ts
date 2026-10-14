import { Type, type Static } from '@sinclair/typebox';
import { CadScalarSchema } from '../cadPrimitives';
import { evaluateCadRecipeScalar } from '../cadExpression';
import { CadError } from '../cadError';

const strict = { additionalProperties: false }, name = Type.String({ pattern: '^[A-Za-z_][A-Za-z0-9_]{0,63}$' });
const condition = Type.Object({ left: CadScalarSchema, operator: Type.Union([Type.Literal('eq'), Type.Literal('ne'), Type.Literal('lt'), Type.Literal('le'), Type.Literal('gt'), Type.Literal('ge')]), right: CadScalarSchema }, strict);
export const CadPluginRulesSchema = Type.Object({
  derived: Type.Array(Type.Object({ name, label: Type.String({ minLength: 1, maxLength: 160 }), unit: Type.String({ maxLength: 20 }), expression: CadScalarSchema }, strict), { maxItems: 32 }),
  fields: Type.Array(Type.Object({ name, group: Type.Union([Type.Literal('main'), Type.Literal('advanced'), Type.Literal('placement')]),
    minimum: CadScalarSchema, maximum: CadScalarSchema, enabledWhen: Type.Optional(condition),
    choices: Type.Optional(Type.Array(Type.Object({ value: Type.Number(), label: Type.String({ minLength: 1, maxLength: 80 }) }, strict), { minItems: 2, maxItems: 16 })) }, strict), { maxItems: 32 }),
  constraints: Type.Array(Type.Object({ ...condition.properties, message: Type.String({ minLength: 1, maxLength: 500 }) }, strict), { maxItems: 32 })
}, strict);
export type CadPluginRules = Static<typeof CadPluginRulesSchema>;
type Condition = Static<typeof condition>;

export function pluginCondition(test: Condition, values: Readonly<Record<string, number>>) {
  const left = evaluateCadRecipeScalar(test.left, values), right = evaluateCadRecipeScalar(test.right, values);
  switch (test.operator) {
    case 'eq': return left === right;
    case 'ne': return left !== right;
    case 'lt': return left < right;
    case 'le': return left <= right;
    case 'gt': return left > right;
    case 'ge': return left >= right;
  }
}

/** Stable graph evaluation; forward references work, cycles and unknown names fail before geometry. */
export function evaluatePluginDerived(rules: CadPluginRules, inputs: Readonly<Record<string, number>>) {
  const values: Record<string, number> = { ...inputs, pi: Math.PI }, visiting = new Set<string>();
  const evaluate = (name: string): number => {
    if (Object.hasOwn(values, name)) return values[name];
    if (visiting.has(name)) throw new CadError('invalid-plugin-rules', `Cyclic plugin relation at "${name}".`);
    const rule = rules.derived.find(rule => rule.name === name);
    if (!rule) throw new CadError('invalid-plugin-rules', `Unknown plugin relation "${name}".`);
    visiting.add(name);
    if (typeof rule.expression === 'string') {
      // Function names are also legal variable names. Only a following '(' makes
      // an identifier a call; skipping all named functions loses forward edges.
      const tokens = rule.expression.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|[^\s]/g) ?? [];
      for (const [index, token] of tokens.entries()) if (/^[A-Za-z_]/.test(token) && tokens[index + 1] !== '(') evaluate(token);
    }
    values[name] = evaluateCadRecipeScalar(rule.expression, values); visiting.delete(name);
    return values[name];
  };
  for (const rule of rules.derived) evaluate(rule.name);
  return values;
}
