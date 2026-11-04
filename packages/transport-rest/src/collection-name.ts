import { kebab } from './kebab.ts';
import { plural } from './plural.ts';

/** The REST collection of an entity: `kebab(plural(name))` unless the `rest.collection` hint says otherwise. */
export function collectionName(entityName: string, hint?: string): string {
  return hint ?? kebab(plural(entityName));
}
