import { isKeelwerkError } from '@keelwerk/core';
import { expect } from 'vitest';

/** The kind and code a promise rejects with; fails the case when it resolves or rejects with anything else. */
export async function failureOf(work: Promise<unknown>): Promise<{ kind: string; code: string }> {
  try {
    await work;
  } catch (error) {
    if (isKeelwerkError(error)) return { kind: error.kind, code: error.code };
    throw error;
  }
  expect.unreachable('the call was expected to be refused');
}
