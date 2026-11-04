/** The SQLSTATE (or the spike's own code) of a failed statement, if the error carries one. */
export function errorCode(error: unknown): string | undefined {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string')
    return error.code;
  return undefined;
}
