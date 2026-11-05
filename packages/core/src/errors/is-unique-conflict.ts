import { KeelwerkError } from './keelwerk-error.ts';

/** Whether `error` is the `conflict` of a unique-index violation (see `uniqueConflict`). */
export function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof KeelwerkError &&
    error.code === 'core.conflict' &&
    (error.details as { readonly unique?: boolean } | undefined)?.unique === true
  );
}
