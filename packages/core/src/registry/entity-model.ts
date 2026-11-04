import type { AnyField } from '../fields/field-def.ts';
import type { EntityEntry } from './entity-entry.ts';

/** An entity entry with the field definitions it was built from (schemas of its actions derive from them). */
export interface EntityModel {
  readonly entry: EntityEntry;
  /** The fields of every active source, by name. */
  readonly fields: Readonly<Record<string, AnyField>>;
  readonly tenancy: EntityEntry['descriptor']['tenancy'];
}
