import type { Shape } from '../fields/shape.ts';
import type { ShapeValue } from '../fields/shape-value.ts';
import type { EntityAt } from '../model/entities-of.ts';
import type { EventsOf } from '../model/events-of.ts';
import type { EventDraft } from '../protocol/event-draft.ts';
import type { Empty } from '../types/empty.ts';

/** `ctx.events`: the target entity's domain events, for entity-mounted commands. */
export type EventDraftsOf<B, E extends string> = [E] extends [never]
  ? Empty
  : {
      readonly [K in keyof EventsOf<EntityAt<B, E>>]: (
        payload: EventsOf<EntityAt<B, E>>[K] extends Shape<infer F>
          ? ShapeValue<F, B extends { readonly id: infer I extends string } ? I : string, 'draft'>
          : never,
      ) => EventDraft;
    };
