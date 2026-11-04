import type { EntityBehaviour } from './entity-behaviour.ts';

/** The behaviour of an entity by reference ('library.book'); `undefined` for an entity without any. */
export type EntityBehaviours = (entity: string) => EntityBehaviour | undefined;
