import type { GeneratedHandlerFactory } from './generated-handler-factory.ts';
import { instanceDraftOf } from './instance-draft-of.ts';

/** The generated `update` (section 6.7): the patch of the input on the loaded row; `id` and `ifVersion` are the kernel's. */
export const generatedUpdate: GeneratedHandlerFactory = (entry) =>
  ((patch: unknown, row: unknown) => ({
    events: [
      instanceDraftOf(
        'update',
        entry.ref,
        row as Record<string, unknown>,
        (patch ?? {}) as Record<string, unknown>,
      ),
    ],
  })) as never;
