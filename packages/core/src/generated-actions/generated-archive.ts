import type { GeneratedHandlerFactory } from './generated-handler-factory.ts';
import { instanceDraftOf } from './instance-draft-of.ts';

/** The generated `archive` (section 6.7): sets `archivedAt` on the loaded row. */
export const generatedArchive: GeneratedHandlerFactory = (entry) =>
  ((_input: unknown, row: unknown) => ({
    events: [instanceDraftOf('archive', entry.ref, row as Record<string, unknown>, {})],
  })) as never;
