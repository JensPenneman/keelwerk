import ts from 'typescript-6';
import { factsOfCall } from './facts-of-call.ts';
import type { Annotation, ExportedValue, ParsedSource } from './parsed-source.ts';

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((m) => m.kind === kind) ?? false)
  );
}

function annotationOf(type: ts.TypeNode | undefined): Annotation {
  if (type === undefined) return 'inferred';
  let typeof_ = false;
  const visit = (node: ts.Node): void => {
    if (ts.isTypeQueryNode(node)) typeof_ = true;
    ts.forEachChild(node, visit);
  };
  visit(type);
  return typeof_ ? 'typeof' : 'named';
}

function localValues(file: ts.SourceFile): Map<string, ts.VariableDeclaration> {
  const found = new Map<string, ts.VariableDeclaration>();
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) found.set(declaration.name.text, declaration);
    }
  }
  return found;
}

function exportedValue(
  name: string,
  declaration: ts.VariableDeclaration | undefined,
  locals: ReadonlyMap<string, ts.VariableDeclaration>,
): ExportedValue {
  const annotation = annotationOf(declaration?.type);
  let initializer = declaration?.initializer;
  for (
    let hops = 0;
    initializer !== undefined && ts.isIdentifier(initializer) && hops < 4;
    hops++
  ) {
    initializer = locals.get(initializer.text)?.initializer;
  }
  return {
    name,
    call: initializer === undefined ? undefined : factsOfCall(initializer),
    annotation,
  };
}

/** Parses one source file with the TypeScript 6.0.3 compiler API and reduces it to what the layout pass compares. */
export function parseSource(path: string, text: string): ParsedSource {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.ES2025, true, ts.ScriptKind.TS);
  const locals = localValues(file);
  const values: ExportedValue[] = [];
  const types: string[] = [];
  const imports = new Map<string, string>();
  const referenced = new Set<string>();
  let defaultExport = false;
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const specifier = ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : '';
      if (clause?.name !== undefined) imports.set(clause.name.text, specifier);
      const named = clause?.namedBindings;
      if (named !== undefined && ts.isNamedImports(named)) {
        for (const element of named.elements) imports.set(element.name.text, specifier);
      }
      continue;
    }
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) referenced.add(node.text);
      ts.forEachChild(node, visit);
    };
    visit(statement);
    if (ts.isExportAssignment(statement)) defaultExport = true;
    if (ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          values.push(exportedValue(declaration.name.text, declaration, locals));
        }
      }
    } else if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) defaultExport = true;
      else if (statement.name !== undefined) {
        values.push({ name: statement.name.text, call: undefined, annotation: 'named' });
      }
    } else if (
      (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      types.push(statement.name.text);
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        const local = (element.propertyName ?? element.name).text;
        if (element.isTypeOnly || statement.isTypeOnly) types.push(element.name.text);
        else values.push(exportedValue(element.name.text, locals.get(local), locals));
      }
    }
  }
  return { path, values, types, defaultExport, imports, referenced };
}
