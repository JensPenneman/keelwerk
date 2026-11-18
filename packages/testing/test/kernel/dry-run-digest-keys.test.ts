import { deriveHkdf, errors, type KeyService } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { command, registryWith } from './support/effects-kit.ts';
import { dry } from './support/explain-kit.ts';

interface Writes {
  readonly write: {
    readonly library: { readonly book: { create(values: Record<string, unknown>): unknown } };
  };
}

/** What a key service without `fork` was asked to derive. */
interface Asked {
  readonly withoutCreate: string[];
  readonly create: string[];
}

/**
 * A key service that cannot fork. A scope has no key: a derive with `create: false` is `not_found`;
 * any other derive is recorded, because it would create a scope key outside the dry run's rollback.
 */
function keysWithoutFork(asked: Asked): KeyService {
  const derive: KeyService['derive'] = (scope, info, length, options) => {
    if (options?.create === false) {
      asked.withoutCreate.push(info);
      return Promise.reject(errors.not_found('The scope has no key.'));
    }
    asked.create.push(info);
    return Promise.resolve(deriveHkdf(new Uint8Array(32), JSON.stringify(scope), info, length));
  };
  return { derive } as unknown as KeyService;
}

describe('the digest of a dry run on a key service that cannot fork (WP-158)', () => {
  const registry = registryWith({
    actions: [
      command('note', (_input: unknown, ctx: Writes) => [
        ctx.write.library.book.create({ title: 'T', isbn: 't-1', addedBy: 'ada' }),
      ]),
    ],
  });
  const input = { title: 'T', isbn: 't-1' };
  const digestOf = async (keys: KeyService): Promise<string | undefined> => {
    const report = await dry(registry, 'library.note', { keys, input }).run();
    if (report.status !== 'decided') throw new Error('the dry run did not decide');
    return report.decision?.inputDigest;
  };

  test('a scope without a key digests in the real form, creates no key and does not fail', async () => {
    const asked: Asked = { withoutCreate: [], create: [] };
    expect(await digestOf(keysWithoutFork(asked))).toMatch(/^kwb1\.[0-9a-f]{64}$/);
    // The key was read once, without create, and nothing else was derived.
    expect(asked.withoutCreate).toHaveLength(1);
    expect(asked.create).toEqual([]);
  });

  test('two dry runs of one input give two digests, since the key is random and of this run alone', async () => {
    const asked: Asked = { withoutCreate: [], create: [] };
    const first = await digestOf(keysWithoutFork(asked));
    const second = await digestOf(keysWithoutFork(asked));
    expect(first).not.toBe(second);
    expect(asked.create).toEqual([]);
  });
});
