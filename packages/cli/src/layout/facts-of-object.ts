import ts from 'typescript-6';
import type { ObjectFacts } from './parsed-source.ts';

function namesOf(node: ts.Expression): readonly string[] {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node)) return [node.getText()];
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(namesOf);
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.flatMap((property) => {
      if (ts.isShorthandPropertyAssignment(property)) return [property.name.text];
      return ts.isPropertyAssignment(property) ? namesOf(property.initializer) : [];
    });
  }
  return [];
}

function keyOf(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

/** Reduces an object literal to the identifiers and strings of its properties. */
export function factsOfObject(node: ts.ObjectLiteralExpression): ObjectFacts {
  const names = new Map<string, readonly string[]>();
  const strings = new Map<string, string>();
  for (const property of node.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      names.set(property.name.text, [property.name.text]);
    } else if (ts.isPropertyAssignment(property)) {
      const key = keyOf(property.name);
      if (key === undefined) continue;
      names.set(key, namesOf(property.initializer));
      if (ts.isStringLiteralLike(property.initializer)) {
        strings.set(key, property.initializer.text);
      }
    }
  }
  return { names, strings };
}
