import { kebab } from '../naming/kebab.ts';

/**
 * The file a rule lives in (decision 60b): the rule id is the module id, the target and the file
 * name, so `library.addBook.signedIn` is `src/policies/add-book/signed-in.ts` of module `library`.
 * The registry records no source path, so the location is derived from the id (section 8.6).
 */
export function ruleFile(id: string, module: string): string {
  const rest = id.startsWith(`${module}.`) ? id.slice(module.length + 1) : id;
  return `src/policies/${rest.split('.').map(kebab).join('/')}.ts`;
}
