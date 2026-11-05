import type { ActionHandler } from '../registry/action-handler.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';

/** Makes the `decide` of a generated command for one entity. */
export type GeneratedHandlerFactory = (entry: EntityEntry) => ActionHandler;
