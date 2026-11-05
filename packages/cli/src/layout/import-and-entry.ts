import { relative } from 'node:path/posix';

/** The import and the entry that list a declaration or part, as the finding's fix names them. */
export function importAndEntry(
  from: string,
  target: string,
  name: string,
  property: string,
): string {
  const specifier = relative(from.slice(0, from.lastIndexOf('/')), target);
  const path = specifier.startsWith('.') ? specifier : `./${specifier}`;
  return `add import { ${name} } from '${path}' and list ${name} under ${property}`;
}
