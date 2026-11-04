import { isKeelwerkError } from '@keelwerk/core';

/** The kind and code of the KeelwerkError a promise rejects with. */
export async function failure(work: Promise<unknown>): Promise<{ kind: string; code: string }> {
  try {
    await work;
  } catch (error) {
    if (isKeelwerkError(error)) return { kind: error.kind, code: error.code };
    throw error;
  }
  throw new Error('expected a KeelwerkError');
}
