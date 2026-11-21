import { isKeelwerkError } from '@keelwerk/core';
import { expect } from 'vitest';

/** What a promise rejects with, as the error itself; fails the case when it resolves. */
export async function quotaRejection(work: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await work;
  } catch (error) {
    if (isKeelwerkError(error)) return error as unknown as Record<string, unknown>;
    throw error;
  }
  return expect.unreachable('the call was expected to be refused');
}
