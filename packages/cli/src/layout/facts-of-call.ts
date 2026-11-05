import ts from 'typescript-6';
import { factsOfObject } from './facts-of-object.ts';
import type { ArgFacts, CallFacts } from './parsed-source.ts';

function argOf(node: ts.Expression): ArgFacts {
  if (ts.isIdentifier(node)) return { kind: 'identifier', name: node.text };
  if (ts.isStringLiteralLike(node)) return { kind: 'string', value: node.text };
  if (ts.isObjectLiteralExpression(node)) return { kind: 'object', facts: factsOfObject(node) };
  if (ts.isArrayLiteralExpression(node)) {
    return {
      kind: 'list',
      names: node.elements.flatMap((element) => (ts.isIdentifier(element) ? [element.text] : [])),
    };
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    const [base, declaration] = node.arguments;
    if (
      node.expression.text === 'within' &&
      base !== undefined &&
      declaration !== undefined &&
      ts.isIdentifier(base) &&
      ts.isIdentifier(declaration)
    ) {
      return { kind: 'within', base: base.text, declaration: declaration.text };
    }
  }
  return { kind: 'other' };
}

/** The call an expression is, looking through `satisfies` and `as`; undefined for anything else. */
export function factsOfCall(node: ts.Expression): CallFacts | undefined {
  let current = node;
  while (ts.isSatisfiesExpression(current) || ts.isAsExpression(current)) {
    current = current.expression;
  }
  if (!ts.isCallExpression(current) || !ts.isIdentifier(current.expression)) return undefined;
  return { callee: current.expression.text, args: current.arguments.map(argOf) };
}
