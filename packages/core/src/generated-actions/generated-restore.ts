import type { GeneratedHandlerFactory } from './generated-handler-factory.ts';
import { instanceDraftOf } from './instance-draft-of.ts';
import { invalidArgument } from './invalid-argument.ts';

/** The generated `restore` (section 6.7): clears `archivedAt` on the loaded row; a row that is not archived is `validation`. */
export const generatedRestore: GeneratedHandlerFactory = (entry) =>
  ((_input: unknown, row: unknown) => {
    const loaded = row as Record<string, unknown>;
    if (loaded.archivedAt === undefined || loaded.archivedAt === null) {
      throw invalidArgument('id', 'The row is not archived.');
    }
    return { events: [instanceDraftOf('restore', entry.ref, loaded, {})] };
  }) as never;
