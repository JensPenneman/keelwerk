import { describe, expect, test } from 'vitest';
import type { Logger } from '../observability/logger.ts';
import type { FlagProvider } from './flag-provider.ts';
import { startFlagProviders } from './start-flag-providers.ts';

describe('startFlagProviders', () => {
  test('starts every provider once and logs a failure at error level', async () => {
    const errors: unknown[] = [];
    const log: Logger = {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: (_message, fields) => {
        errors.push(fields?.provider);
      },
      child: () => log,
    };
    const started: string[] = [];
    const make = (id: string, fail: 'no' | 'reject' | 'throw'): FlagProvider => ({
      id,
      sync: true,
      resolve: () => undefined,
      start: () => {
        started.push(id);
        if (fail === 'throw') throw new Error('x');
        return fail === 'reject' ? Promise.reject(new Error('x')) : Promise.resolve();
      },
    });
    startFlagProviders(
      [make('a', 'no'), make('b', 'reject'), make('c', 'throw')],
      new AbortController().signal,
      log,
    );
    await Promise.resolve();
    expect(started).toEqual(['a', 'b', 'c']);
    expect(errors.sort()).toEqual(['b', 'c']);
  });
});
