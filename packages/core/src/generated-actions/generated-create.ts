import type { Gen } from '../protocol/gen.ts';
import { createDraftOf } from './create-draft-of.ts';
import type { GeneratedHandlerFactory } from './generated-handler-factory.ts';
import { invalidArgument } from './invalid-argument.ts';

interface IdContext {
  newId(entity: string): Gen<string>;
}

/**
 * The generated `create` (section 6.7): a new id and a `created` draft of the input's fields. The
 * id is always asked of the interpreter; an input that names one is refused, ids are minted by the
 * server (section 7.9.3).
 */
export const generatedCreate: GeneratedHandlerFactory = (entry) =>
  function* create(input: unknown, ctx: unknown) {
    const values = (input ?? {}) as Readonly<Record<string, unknown>>;
    if ('id' in values) throw invalidArgument('id', "A new row's id is minted by the server.");
    const id = yield* (ctx as IdContext).newId(entry.ref);
    return { events: [createDraftOf(entry.ref, id, values)] };
  } as never;
