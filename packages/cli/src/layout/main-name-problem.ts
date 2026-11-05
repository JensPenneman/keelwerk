import { camelFromKebab, kebab } from '@keelwerk/core';
import { nameSuffixes } from './name-suffixes.ts';
import type { ParsedSource } from './parsed-source.ts';

/**
 * The file named after its export (section 23.4): the export's name, without the kind a
 * directory adds, is `kebab()` of the file name. A type-only file is named after its main type.
 * Returns the message of the mismatch, or undefined when the file is named right.
 */
export function mainNameProblem(
  source: ParsedSource,
  name: string,
  directory: string | undefined,
): string | undefined {
  const suffix = directory === undefined ? '' : (nameSuffixes.get(directory) ?? '');
  const expected = `${camelFromKebab(name)}${suffix}`;
  const exported = source.values.map((value) => value.name);
  if (exported.length === 0) {
    return source.types.some((type) => kebab(type) === name)
      ? undefined
      : `${name}.ts exports no type named ${expected.charAt(0).toUpperCase()}${expected.slice(1)}`;
  }
  if (exported.includes(expected)) return undefined;
  const first = exported[0] ?? '';
  const stripped = suffix !== '' && first.endsWith(suffix) ? first.slice(0, -suffix.length) : first;
  return `${name}.ts exports ${first}, so the file is ${kebab(stripped)}.ts${suffix !== '' && !first.endsWith(suffix) ? ` and the export ends in ${suffix}` : ''}`;
}
