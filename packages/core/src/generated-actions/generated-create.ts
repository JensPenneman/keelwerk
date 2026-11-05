import type { Gen } from '../protocol/gen.ts';
import { createDraftOf } from './create-draft-of.ts';
import type { GeneratedHandlerFactory } from './generated-handler-factory.ts';

interface IdContext {
  newId(entity: string): Gen<string>;
}

/** The generated `create` (section 6.7): a new id and a `created` draft of the input's fields. */
export const generatedCreate: GeneratedHandlerFactory = (entry) =>
  function* create(input: unknown, ctx: unknown) {
    const id = yield* (ctx as IdContext).newId(entry.ref);
    const values = (input ?? {}) as Readonly<Record<string, unknown>>;
    return { events: [createDraftOf(entry.ref, id, values)] };
  } as never;
