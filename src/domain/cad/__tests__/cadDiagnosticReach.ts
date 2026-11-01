import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// TypeScript 7 ships no compiler API yet; AST tooling uses the TypeScript 6 package.
import ts from '@typescript/typescript6';

/**
 * The `CadError` codes code can raise, found without running it. From each root it follows, through the source of `src`, every name a
 * walked function uses: the nearest declaration in scope, an import to the declaration it names, members of constant objects and
 * namespace imports, `this` members, and a method called on another receiver when exactly one class or constant object in the source
 * declares that name. It collects the first argument of each `CadError` (each branch of a conditional), and the `code` of each object
 * literal, which carries a refusal to the `CadError` an inspection raises. A template code is expanded through `templates`, the values
 * each substitution takes keyed by `file: source text`; one it cannot expand is reported. A used class runs its constructor and field
 * initializers; its methods are walked only when called. An overload signature stands for its implementation.
 */
export interface CadDiagnosticReach {
  readonly codes: ReadonlySet<string>;
  /** Codes it could not read: templates `templates` does not expand, and other computed codes, as `file: text`. */
  readonly unexpanded: readonly string[];
  /** The named functions, variables, classes and members it walked, as `file:name`. */
  readonly declarations: ReadonlySet<string>;
}
export interface CadDiagnosticRoot { readonly file: string; readonly node: ts.Node }
export interface CadDiagnosticReachOptions {
  /**
   * The values a template substitution takes, keyed by `file: source text`: a list, or a function of the declarations walked, for a
   * substitution whose value depends on the caller, such as an operation name each caller passes.
   */
  readonly templates?: Readonly<Record<string, readonly string[] | ((declarations: ReadonlySet<string>) => readonly string[])>>;
  /** Declarations not to walk, as `file:name`: hubs such as a registry, whose members are other kinds' evaluators. */
  readonly stop?: ReadonlySet<string>;
  /** The object a parameter stands for, by file and parameter name, such as the parse context a kind's checks are given. */
  readonly receivers?: (file: string, name: string) => CadDiagnosticRoot | undefined;
}

type Import = { readonly module: string; readonly name: string };
interface Member { readonly file: string; readonly node: ts.Node }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);
}
function propertyName(name: ts.PropertyName | ts.DeclarationName | undefined): string | undefined {
  return name && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name)) ? name.text : undefined;
}
function binds(name: ts.BindingName, wanted: string): boolean {
  return ts.isIdentifier(name) ? name.text === wanted : name.elements.some(element => !ts.isOmittedExpression(element) && binds(element.name, wanted));
}
/** The expression without parentheses, assertions and `Object.freeze`, which leave the object it gives. */
export function bareExpression(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)
    || (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === 'Object' && node.expression.name.text === 'freeze' && node.arguments.length === 1))
    node = ts.isCallExpression(node) ? node.arguments[0] : node.expression;
  return node;
}

/**
 * The declaration `identifier` names in its own file: a function, class or variable in an enclosing scope, `parameter` for a parameter,
 * loop, catch or destructured variable, which stands for a value the walk cannot follow, or undefined for a name declared elsewhere.
 */
function lexical(identifier: ts.Identifier): ts.Node | 'parameter' | undefined {
  const name = identifier.text;
  const inStatements = (statements: readonly ts.Statement[]) => {
    for (const statement of statements) {
      if (ts.isFunctionDeclaration(statement) && !statement.body) continue; // An overload signature; its implementation follows.
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name?.text === name) return statement;
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration;
        if (!ts.isIdentifier(declaration.name) && binds(declaration.name, name)) return 'parameter' as const;
      }
    }
    return undefined;
  };
  for (let scope: ts.Node | undefined = identifier.parent; scope; scope = scope.parent) {
    if (isFunctionLike(scope)) {
      if (scope.parameters.some(parameter => binds(parameter.name, name))) return 'parameter';
      if (ts.isFunctionExpression(scope) && scope.name?.text === name) return scope;
    }
    if (ts.isCatchClause(scope) && scope.variableDeclaration && binds(scope.variableDeclaration.name, name)) return 'parameter';
    if ((ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope)) && scope.initializer && ts.isVariableDeclarationList(scope.initializer)
      && scope.initializer.declarations.some(declaration => binds(declaration.name, name))) return 'parameter';
    if (ts.isClassExpression(scope) && scope.name?.text === name) return scope;
    const found = ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isModuleBlock(scope) ? inStatements(scope.statements)
      : ts.isCaseBlock(scope) ? scope.clauses.map(clause => inStatements(clause.statements)).find(Boolean) : undefined;
    if (found) return found;
  }
  return undefined;
}

export class CadSourceIndex {
  readonly files = new Map<string, ts.SourceFile>();
  private readonly imports = new Map<string, Map<string, Import>>();
  private readonly exports = new Map<string, Map<string, Import>>();
  private readonly starExports = new Map<string, string[]>();
  private readonly members = new Map<string, Member[]>();

  constructor() {
    const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src'], { cwd: root, encoding: 'utf8' })
      .split('\n').filter(file => /\.tsx?$/.test(file) && !file.endsWith('.d.ts') && !/(__tests__|\.test\.|\.spec\.)/.test(file));
    for (const file of files) {
      const source = ts.createSourceFile(file, readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      this.files.set(file, source);
    }
    for (const [file, source] of this.files) this.indexFile(file, source);
  }

  private resolveModule(from: string, specifier: string): string | undefined {
    const bare = specifier.split('?')[0];
    const base = bare.startsWith('@/') ? `src/${bare.slice(2)}` : bare.startsWith('.') ? path.posix.join(path.posix.dirname(from), bare) : undefined;
    return base && ['.ts', '.tsx', '/index.ts', '/index.tsx', ''].map(ending => base + ending).find(candidate => this.files.has(candidate));
  }

  private indexFile(file: string, source: ts.SourceFile) {
    const imports = new Map<string, Import>(), exports = new Map<string, Import>(), stars: string[] = [];
    const member = (name: string, node: ts.Node) => {
      const list = this.members.get(name), entry = { file, node };
      if (list) list.push(entry); else this.members.set(name, [entry]);
    };
    const exported = (node: ts.Node) => ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
    for (const statement of source.statements) {
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name && exported(statement))
        exports.set(statement.name.text, { module: file, name: statement.name.text });
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        if (exported(statement)) exports.set(declaration.name.text, { module: file, name: declaration.name.text });
        const value = declaration.initializer && bareExpression(declaration.initializer);
        if (value && ts.isObjectLiteralExpression(value)) for (const property of value.properties) {
          const name = propertyName(property.name);
          if (name && (ts.isMethodDeclaration(property) || ts.isPropertyAssignment(property))) member(name, property);
        }
      }
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.importClause && !statement.importClause.isTypeOnly) {
        const module = this.resolveModule(file, statement.moduleSpecifier.text);
        if (!module) continue;
        const clause = statement.importClause, bindings = clause.namedBindings;
        if (clause.name) imports.set(clause.name.text, { module, name: 'default' });
        if (bindings && ts.isNamespaceImport(bindings)) imports.set(bindings.name.text, { module, name: '*' });
        else if (bindings) for (const element of bindings.elements) if (!element.isTypeOnly) imports.set(element.name.text, { module, name: (element.propertyName ?? element.name).text });
      }
      if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
        const module = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? this.resolveModule(file, statement.moduleSpecifier.text) : file;
        if (!module) continue;
        if (!statement.exportClause) stars.push(module);
        else if (ts.isNamedExports(statement.exportClause)) for (const element of statement.exportClause.elements)
          exports.set(element.name.text, { module, name: (element.propertyName ?? element.name).text });
      }
      if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) exports.set('default', { module: file, name: statement.expression.text });
    }
    const visit = (node: ts.Node) => {
      if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.name) for (const element of node.members) {
        const name = propertyName(element.name);
        if (name && (ts.isMethodDeclaration(element) || ts.isGetAccessorDeclaration(element) || ts.isPropertyDeclaration(element))) member(name, element);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    this.imports.set(file, imports); this.exports.set(file, exports); this.starExports.set(file, stars);
  }

  /** The declarations `identifier` names: the nearest in scope, or what an import of it names. */
  resolve(file: string, identifier: ts.Identifier): readonly CadDiagnosticRoot[] {
    const local = lexical(identifier);
    if (local === 'parameter') return [];
    if (local) return [{ file, node: local }];
    const imported = this.imports.get(file)?.get(identifier.text);
    return imported && imported.name !== '*' ? this.exported(imported.module, imported.name, new Set()) : [];
  }
  /** The namespace module `name` imports in `file`, if it is one. */
  namespace(file: string, name: string): string | undefined {
    const imported = this.imports.get(file)?.get(name);
    return imported?.name === '*' ? imported.module : undefined;
  }
  exported(module: string, name: string, seen: Set<string>): readonly CadDiagnosticRoot[] {
    if (seen.has(module)) return [];
    seen.add(module);
    const entry = this.exports.get(module)?.get(name);
    if (entry) {
      if (entry.module !== module) return this.exported(entry.module, entry.name, new Set());
      const source = this.files.get(module)!;
      for (const statement of source.statements) {
        if (ts.isFunctionDeclaration(statement) && !statement.body) continue;
        if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === entry.name) return [{ file: module, node: statement }];
        if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations)
          if (ts.isIdentifier(declaration.name) && declaration.name.text === entry.name) return [{ file: module, node: declaration }];
      }
      return [];
    }
    for (const star of this.starExports.get(module) ?? []) {
      const found = this.exported(star, name, seen);
      if (found.length) return found;
    }
    return [];
  }
  /** Methods and properties of classes and constant objects named `name`. */
  membersNamed(name: string): readonly Member[] { return this.members.get(name) ?? []; }
}

/** Names whose methods are the platform's or a library's, never this source's, when the receiver is not known. */
const PLATFORM = new Set(['get', 'set', 'has', 'add', 'delete', 'clear', 'map', 'filter', 'find', 'some', 'every', 'forEach', 'reduce', 'push', 'pop',
  'slice', 'splice', 'concat', 'join', 'includes', 'indexOf', 'flatMap', 'sort', 'keys', 'values', 'entries', 'then', 'catch', 'finally', 'call', 'apply',
  'bind', 'toString', 'dispose', 'next', 'test', 'exec', 'replace', 'split', 'trim', 'at', 'fill', 'from', 'of', 'assign', 'freeze']);

export function cadDiagnosticReach(index: CadSourceIndex, roots: readonly CadDiagnosticRoot[], options: CadDiagnosticReachOptions = {}): CadDiagnosticReach {
  const { templates = {}, stop = new Set<string>(), receivers } = options;
  const codes = new Set<string>(), unexpanded = new Set<string>(), walked = new Set<ts.Node>(), declarations = new Set<string>();
  const templated: { readonly file: string; readonly value: ts.TemplateExpression }[] = [];
  const queue: CadDiagnosticRoot[] = [...roots];
  const push = ({ file, node }: CadDiagnosticRoot) => {
    const name = (node as { name?: ts.Node }).name;
    if (name && ts.isIdentifier(name) && stop.has(`${file}:${name.text}`)) return;
    const named = name && propertyName(name as ts.PropertyName);
    if (named) declarations.add(`${file}:${named}`);
    // A variable's initializer and a class's constructor and field initializers are what using them runs.
    if (ts.isVariableDeclaration(node)) { if (node.initializer) queue.push({ file, node: node.initializer }); }
    else if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      for (const element of node.members) if (ts.isConstructorDeclaration(element) || ts.isPropertyDeclaration(element) && element.initializer) queue.push({ file, node: element });
    } else queue.push({ file, node });
  };
  const codesOf = (file: string, expression: ts.Expression) => {
    const value = bareExpression(expression);
    if (ts.isStringLiteralLike(value)) codes.add(value.text);
    else if (ts.isConditionalExpression(value)) { codesOf(file, value.whenTrue); codesOf(file, value.whenFalse); }
    // Expanded once the walk is complete, when every declaration a substitution's values may depend on is known.
    else if (ts.isTemplateExpression(value)) templated.push({ file, value });
    // A code passed on from an inspection or a refusal was collected where its literal was written.
    else if (!(ts.isIdentifier(value) ? value.text === 'code' : ts.isPropertyAccessExpression(value) && value.name.text === 'code')) unexpanded.add(`${file}: ${value.getText()}`);
  };
  const member = (file: string, access: ts.PropertyAccessExpression) => {
    const name = access.name.text, receiver = bareExpression(access.expression);
    if (ts.isIdentifier(receiver)) {
      const namespace = index.namespace(file, receiver.text);
      if (namespace) { index.exported(namespace, name, new Set()).forEach(push); return; }
      const declared = index.resolve(file, receiver);
      const objects = declared.flatMap(found => {
        const value = ts.isVariableDeclaration(found.node) && found.node.initializer && bareExpression(found.node.initializer);
        return value && ts.isObjectLiteralExpression(value) ? [{ file: found.file, value }] : [];
      });
      if (lexical(receiver) === 'parameter') {
        const stands = receivers?.(file, receiver.text);
        if (stands && ts.isObjectLiteralExpression(stands.node)) objects.push({ file: stands.file, value: stands.node });
      }
      if (objects.length) {
        for (const { file: owner, value } of objects) for (const property of value.properties) if (propertyName(property.name) === name) push({ file: owner, node: property });
        return;
      }
    }
    if (receiver.kind === ts.SyntaxKind.ThisKeyword) {
      const owner = ts.findAncestor(access, node => ts.isClassLike(node)) as ts.ClassLikeDeclaration | undefined;
      for (const element of owner?.members ?? []) if (propertyName(element.name) === name) push({ file, node: element });
      return;
    }
    const called = ts.isCallExpression(access.parent) && access.parent.expression === access;
    const candidates = called && !PLATFORM.has(name) ? index.membersNamed(name) : [];
    if (candidates.length === 1) push(candidates[0]);
  };
  while (queue.length) {
    const { file, node } = queue.pop()!;
    if (walked.has(node)) continue;
    walked.add(node);
    const visit = (child: ts.Node) => {
      if (ts.isTypeNode(child) || ts.isInterfaceDeclaration(child) || ts.isTypeAliasDeclaration(child) || ts.isImportDeclaration(child)) return;
      if ((ts.isNewExpression(child) || ts.isCallExpression(child)) && ts.isIdentifier(child.expression) && child.expression.text === 'CadError' && child.arguments?.[0]) codesOf(file, child.arguments[0]);
      else if (ts.isPropertyAssignment(child) && propertyName(child.name) === 'code') {
        const value = bareExpression(child.initializer);
        if (ts.isStringLiteralLike(value) || ts.isConditionalExpression(value)) codesOf(file, value);
      }
      if (ts.isIdentifier(child) && isReference(child)) index.resolve(file, child).forEach(push);
      if (ts.isPropertyAccessExpression(child)) member(file, child);
      ts.forEachChild(child, visit);
    };
    if (isFunctionLike(node)) { if (node.body) visit(node.body); for (const parameter of node.parameters) if (parameter.initializer) visit(parameter.initializer); }
    else if (ts.isPropertyDeclaration(node)) { if (node.initializer) visit(node.initializer); }
    else if (ts.isPropertyAssignment(node)) visit(node.initializer);
    else visit(node);
  }
  expansion: for (const { file, value } of templated) {
    let variants = [value.head.text];
    for (const span of value.templateSpans) {
      const key = `${file}: ${span.expression.getText()}`, given = templates[key];
      if (!given) { unexpanded.add(key); continue expansion; }
      const options = typeof given === 'function' ? given(declarations) : given;
      variants = variants.flatMap(prefix => options.map(option => prefix + option + span.literal.text));
    }
    for (const variant of variants) codes.add(variant);
  }
  return { codes, unexpanded: [...unexpanded].sort(), declarations };
}

/** Whether the identifier uses a value, rather than naming a declaration, a member or a property. */
function isReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if ((ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)
    || ts.isPropertySignature(parent) || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) || ts.isEnumMember(parent)) && parent.name === node) return false;
  return !((ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent)
    || ts.isFunctionExpression(parent) || ts.isClassExpression(parent) || ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)
    || ts.isExportSpecifier(parent) || ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) && (parent as { name?: ts.Node; label?: ts.Node }).name === node);
}
