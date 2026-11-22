/** The text of a thrown value. */
export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
