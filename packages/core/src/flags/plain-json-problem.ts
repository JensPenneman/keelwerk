const mostDepth = 32;

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** The first reason a value is not plain JSON a store can keep, or undefined. */
export function plainJsonProblem(
  value: unknown,
  depth: number,
  inside: boolean,
): string | undefined {
  if (depth > mostDepth) return `is nested deeper than ${mostDepth} levels`;
  if (value === null) return inside ? undefined : 'must not be null';
  switch (typeof value) {
    case 'boolean':
      return undefined;
    case 'number':
      return Number.isFinite(value) ? undefined : 'must be a finite number';
    case 'string':
      if (!value.isWellFormed()) return 'holds a lone surrogate';
      return value.includes('\u0000') ? 'holds U+0000' : undefined;
    case 'object':
      break;
    default:
      return 'is not plain JSON';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const problem = plainJsonProblem(item, depth + 1, true);
      if (problem !== undefined) return problem;
    }
    return undefined;
  }
  if (!isPlainObject(value)) return 'is not plain JSON';
  for (const [name, member] of Object.entries(value)) {
    const nameProblem = plainJsonProblem(name, depth + 1, true);
    if (nameProblem !== undefined) return nameProblem;
    const problem = plainJsonProblem(member, depth + 1, true);
    if (problem !== undefined) return problem;
  }
  return undefined;
}
