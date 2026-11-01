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
 * declares that name. A used class runs its constructor and field initializers; its methods are walked only when called. An overload
 * signature stands for its implementation.
 *
 * It collects the first argument of each `CadError` and the `code` of each object literal, which carries a refusal to the `CadError` an
 * inspection raises. A code is read through each branch of a conditional, constants, properties of object literals (an absent one holds
 * none), elements of list literals, `for…of` variables and the first parameter of a list iteration's callback, and a parameter at each
 * call of its function the walk reaches. A template code is expanded through `templates`, the values each substitution takes keyed by
 * `file: source text`. Two codes are taken where they were written: a caught error's `code`, which its `CadError` in the walked `try`
 * block gave, and the `code` of what a function of the source returns, which an object literal it builds holds; both are listed as
 * `taken`. Any other code is reported: a template `templates` does not expand, a variable that is not constant, another call's result,
 * a property a spread may replace, and a parameter of a function passed on as a value, whose calls the walk cannot see.
 */
export interface CadDiagnosticReach {
  readonly codes: ReadonlySet<string>;
  /** Codes it could not read, as `file: text`, followed by `, from file: text` where the reading stopped elsewhere. */
  readonly unexpanded: readonly string[];
  /** Codes taken where they were written, a caught error's or a function's result, in the same form. */
  readonly taken: readonly string[];
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
interface CadReference { readonly file: string; readonly identifier: ts.Identifier }
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
 * A name that is no declaration the walk can enter: a function's parameter, a caught error, an element of a list (a `for…of` variable,
 * or the first parameter of a callback given to a list's iteration method), or another loop or destructured variable.
 */
type Binding =
  | { readonly kind: 'parameter'; readonly owner: ts.FunctionLikeDeclaration; readonly position: number }
  | { readonly kind: 'caught' }
  | { readonly kind: 'element'; readonly of: ts.Expression }
  | { readonly kind: 'variable' };
/** The path segment that reads any element of a list. */
const ELEMENT = '[]';
/** List methods whose callback's first parameter is each element. */
const ITERATIONS = new Set(['map', 'flatMap', 'forEach', 'some', 'every', 'find', 'findLast', 'filter', 'findIndex', 'findLastIndex']);

/**
 * The declaration `identifier` names in its own file: a function, class or variable in an enclosing scope, `parameter` for a parameter,
 * loop, catch or destructured variable, which stands for a value the walk cannot follow, or undefined for a name declared elsewhere.
 */
function lexical(identifier: ts.Identifier): ts.Node | 'parameter' | undefined {
  const found = binding(identifier);
  return found && isBinding(found) ? 'parameter' : found;
}
/** Bindings' kinds are words; syntax kinds are numbers. */
const isBinding = (found: ts.Node | Binding): found is Binding => typeof found.kind === 'string';
/** What `identifier` names in its own file: its declaration, a {@link Binding}, or undefined for a name declared elsewhere. */
function binding(identifier: ts.Identifier): ts.Node | Binding | undefined {
  const name = identifier.text, variable = { kind: 'variable' } as const;
  const inStatements = (statements: readonly ts.Statement[]) => {
    for (const statement of statements) {
      if (ts.isFunctionDeclaration(statement) && !statement.body) continue; // An overload signature; its implementation follows.
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name?.text === name) return statement;
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration;
        if (!ts.isIdentifier(declaration.name) && binds(declaration.name, name)) return variable;
      }
    }
    return undefined;
  };
  for (let scope: ts.Node | undefined = identifier.parent; scope; scope = scope.parent) {
    if (isFunctionLike(scope)) {
      const position = scope.parameters.findIndex(parameter => binds(parameter.name, name));
      if (position >= 0) {
        if (!ts.isIdentifier(scope.parameters[position].name)) return variable;
        const call = scope.parent;
        if (position === 0 && ts.isCallExpression(call) && call.arguments[0] === scope && ts.isPropertyAccessExpression(call.expression) && ITERATIONS.has(call.expression.name.text))
          return { kind: 'element', of: call.expression.expression };
        return { kind: 'parameter', owner: scope, position };
      }
      if (ts.isFunctionExpression(scope) && scope.name?.text === name) return scope;
    }
    if (ts.isCatchClause(scope) && scope.variableDeclaration && binds(scope.variableDeclaration.name, name))
      return ts.isIdentifier(scope.variableDeclaration.name) ? { kind: 'caught' } : variable;
    if ((ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope)) && scope.initializer && ts.isVariableDeclarationList(scope.initializer)
      && scope.initializer.declarations.some(declaration => binds(declaration.name, name)))
      return ts.isForOfStatement(scope) && ts.isIdentifier(scope.initializer.declarations[0].name) ? { kind: 'element', of: scope.expression } : variable;
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

  private readonly referenceCache = new Map<ts.Node, readonly CadReference[]>();

  /** Indexes the source of `src`, or `sources`, text by path, for a test of the walk itself. */
  constructor(sources?: Readonly<Record<string, string>>) {
    const files = sources ? Object.keys(sources) : execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src'], { cwd: root, encoding: 'utf8' })
      .split('\n').filter(file => /\.tsx?$/.test(file) && !file.endsWith('.d.ts') && !/(__tests__|\.test\.|\.spec\.)/.test(file));
    for (const file of files) {
      const text = sources ? sources[file] : readFileSync(path.join(root, file), 'utf8');
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
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
  /** Every use of `name` in the source that resolves to `declaration`. */
  references(declaration: CadDiagnosticRoot, name: string): readonly CadReference[] {
    const cached = this.referenceCache.get(declaration.node);
    if (cached) return cached;
    const found: CadReference[] = [];
    for (const [file, source] of this.files) {
      if (!source.text.includes(name)) continue;
      const visit = (node: ts.Node) => {
        if (ts.isIdentifier(node) && node.text === name && isReference(node) && this.resolve(file, node).some(target => target.node === declaration.node)) found.push({ file, identifier: node });
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    this.referenceCache.set(declaration.node, found);
    return found;
  }
}

/** Names whose methods are the platform's or a library's, never this source's, when the receiver is not known. */
const PLATFORM = new Set(['get', 'set', 'has', 'add', 'delete', 'clear', 'map', 'filter', 'find', 'some', 'every', 'forEach', 'reduce', 'push', 'pop',
  'slice', 'splice', 'concat', 'join', 'includes', 'indexOf', 'flatMap', 'sort', 'keys', 'values', 'entries', 'then', 'catch', 'finally', 'call', 'apply',
  'bind', 'toString', 'dispose', 'next', 'test', 'exec', 'replace', 'split', 'trim', 'at', 'fill', 'from', 'of', 'assign', 'freeze']);

export function cadDiagnosticReach(index: CadSourceIndex, roots: readonly CadDiagnosticRoot[], options: CadDiagnosticReachOptions = {}): CadDiagnosticReach {
  const { templates = {}, stop = new Set<string>(), receivers } = options;
  const codes = new Set<string>(), unexpanded = new Set<string>(), taken = new Set<string>(), walked = new Set<ts.Node>(), declarations = new Set<string>();
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
  /** Parameters that carry a code, read at the function's walked calls once the walk is complete. */
  const passed: { readonly file: string; readonly owner: ts.FunctionLikeDeclaration; readonly position: number; readonly path: readonly string[]; readonly at: string }[] = [];
  const read = new Set<string>();
  /** Whether `callee` names a function of the source, which the walk enters. */
  const declared = (file: string, callee: ts.Expression): boolean => {
    const value = bareExpression(callee);
    if (ts.isIdentifier(value)) return index.resolve(file, value).length > 0;
    const namespace = ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression) ? index.namespace(file, value.expression.text) : undefined;
    return !!namespace && index.exported(namespace, (value as ts.PropertyAccessExpression).name.text, new Set()).length > 0;
  };
  /** Collects the codes `expression` gives once the properties `path` names are read off it; `at` is the site reported if it cannot. */
  const codesOf = (file: string, expression: ts.Expression, path: readonly string[] = [], at = `${file}: ${expression.getText()}`): void => {
    const value = bareExpression(expression), key = `${file}:${value.pos}:${value.end}:${path.join('.')}`;
    if (read.has(key)) return;
    read.add(key);
    // Where the reading stopped, if not at the site itself; a call is shown by its callee.
    const site = (text = expression.getText()) => {
      const here = `${file}: ${text}${path.map(name => name === ELEMENT ? ELEMENT : `.${name}`).join('')}`;
      return here === at ? at : `${at}, from ${here}`;
    };
    const unread = () => { unexpanded.add(site()); };
    if (ts.isConditionalExpression(value)) { codesOf(file, value.whenTrue, path, at); codesOf(file, value.whenFalse, path, at); return; }
    if (!path.length && ts.isStringLiteralLike(value)) { codes.add(value.text); return; }
    // Expanded once the walk is complete, when every declaration a substitution's values may depend on is known.
    if (!path.length && ts.isTemplateExpression(value)) { templated.push({ file, value }); return; }
    if (ts.isPropertyAccessExpression(value)) { codesOf(file, value.expression, [value.name.text, ...path], at); return; }
    if (ts.isElementAccessExpression(value) && (ts.isStringLiteralLike(value.argumentExpression) || ts.isNumericLiteral(value.argumentExpression))) {
      codesOf(file, value.expression, [ts.isNumericLiteral(value.argumentExpression) ? ELEMENT : value.argumentExpression.text, ...path], at);
      return;
    }
    if (ts.isArrayLiteralExpression(value) && path[0] === ELEMENT) {
      for (const element of value.elements) if (!ts.isOmittedExpression(element))
        codesOf(file, ts.isSpreadElement(element) ? element.expression : element, ts.isSpreadElement(element) ? path : path.slice(1), at);
      return;
    }
    if (ts.isObjectLiteralExpression(value) && path.length) {
      // The last property of that name, unless a spread after it may replace it. An absent property holds no code.
      const [name, ...rest] = path, property = [...value.properties].reverse().find(property => ts.isSpreadAssignment(property) || propertyName(property.name) === name);
      if (property && ts.isPropertyAssignment(property)) codesOf(file, property.initializer, rest, at);
      else if (property && ts.isShorthandPropertyAssignment(property)) codesOf(file, property.name, rest, at);
      else if (property) unread();
      return;
    }
    if (ts.isIdentifier(value)) {
      const bound = binding(value);
      if (bound && isBinding(bound)) {
        if (bound.kind === 'parameter') passed.push({ file, owner: bound.owner, position: bound.position, path, at });
        else if (bound.kind === 'element') codesOf(file, bound.of, [ELEMENT, ...path], at);
        // A caught error's code was collected at the `CadError` that raised it, in the walked `try` block.
        else if (bound.kind === 'caught' && path.length === 1 && path[0] === 'code') taken.add(site());
        else unread();
        return;
      }
      const constant = index.resolve(file, value).find(found => ts.isVariableDeclaration(found.node) && found.node.initializer
        && (ts.getCombinedNodeFlags(found.node) & ts.NodeFlags.Const) !== 0);
      if (constant) codesOf(constant.file, (constant.node as ts.VariableDeclaration).initializer!, path, at);
      else unread();
      return;
    }
    // What an inspection returns: the code of each object it builds is collected where that object is written.
    if (ts.isCallExpression(value) && path.at(-1) === 'code' && declared(file, value.expression)) taken.add(site(`${value.expression.getText()}(…)`));
    else unread();
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
      else if (ts.isPropertyAssignment(child) && propertyName(child.name) === 'code') codesOf(file, child.initializer);
      else if (ts.isShorthandPropertyAssignment(child) && child.name.text === 'code') codesOf(file, child.name);
      if (ts.isIdentifier(child) && isReference(child)) index.resolve(file, child).forEach(push);
      if (ts.isPropertyAccessExpression(child)) member(file, child);
      ts.forEachChild(child, visit);
    };
    if (isFunctionLike(node)) { if (node.body) visit(node.body); for (const parameter of node.parameters) if (parameter.initializer) visit(parameter.initializer); }
    else if (ts.isPropertyDeclaration(node)) { if (node.initializer) visit(node.initializer); }
    else if (ts.isPropertyAssignment(node)) visit(node.initializer);
    else visit(node);
  }
  // A parameter gives what each walked call passes it; a function passed on as a value has callers the walk cannot see.
  const inWalk = (node: ts.Node) => ts.findAncestor(node, ancestor => walked.has(ancestor)) !== undefined;
  for (let next = passed.pop(); next; next = passed.pop()) {
    const { file, owner, position, path, at } = next, named = functionName(owner);
    if (!named) { unexpanded.add(`${at}, from ${file}: ${owner.parameters[position].name.getText()}`); continue; }
    for (const { file: caller, identifier } of index.references({ file, node: named.declaration }, named.name)) {
      if (!inWalk(identifier)) continue;
      const call = identifier.parent;
      if (!((ts.isCallExpression(call) || ts.isNewExpression(call)) && call.expression === identifier)) { unexpanded.add(`${caller}: ${identifier.text} passed on`); continue; }
      const given = call.arguments ?? [], fallback = owner.parameters[position].initializer;
      if (given.slice(0, position + 1).some(ts.isSpreadElement)) unexpanded.add(`${caller}: ${call.getText()}`);
      else if (given[position]) codesOf(caller, given[position], path, at);
      else if (fallback) codesOf(file, fallback, path, at);
      else unexpanded.add(`${caller}: ${call.getText()}`);
    }
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
  return { codes, unexpanded: [...unexpanded].sort(), taken: [...taken].sort(), declarations };
}

/** The name a function is called by and the declaration it resolves to: a function declaration, or a variable holding the function. */
function functionName(owner: ts.FunctionLikeDeclaration): { readonly name: string; readonly declaration: ts.Node } | undefined {
  if (ts.isFunctionDeclaration(owner) && owner.name) return { name: owner.name.text, declaration: owner };
  const holder = owner.parent;
  if ((ts.isArrowFunction(owner) || ts.isFunctionExpression(owner)) && ts.isVariableDeclaration(holder) && holder.initializer === owner && ts.isIdentifier(holder.name))
    return { name: holder.name.text, declaration: holder };
  return undefined;
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
