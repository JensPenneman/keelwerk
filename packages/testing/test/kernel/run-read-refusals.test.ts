import type { ActionEntry } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import type { ProbeContext } from './support/run-read-kit.ts';
import { runnable, withQuery } from './support/run-read-kit.ts';

describe('what a query may not request (S-06, S-05)', () => {
  const forged = (kind: string, extra: Record<string, unknown> = {}) =>
    function* (): Generator<unknown, unknown, unknown> {
      const request: Record<PropertyKey, unknown> = {
        kind,
        ...extra,
        *[Symbol.iterator](): Generator<unknown, unknown, unknown> {
          return yield request;
        },
      };
      return yield* request as unknown as Generator<never, unknown, unknown>;
    };

  test.each([
    ['an id', forged('id', { entity: 'book' })],
    ['random bytes', forged('random', { bytes: 8 })],
    ['an issued secret', forged('secret', { op: 'issue', args: [{ prefix: 'x' }] })],
    ['an inline effect', forged('perform', { effect: { kind: 'external' } })],
    [
      'a reveal, which this release does not answer',
      forged('secret', { op: 'reveal', args: [{ ref: 'x' }, 'why'] }),
    ],
  ])('%s fails with core.request_not_allowed', async (_name, handler) => {
    const probe = withQuery('forged', handler);
    const { run } = runnable({ registry: probe.registry, action: probe.ref });
    await expect(run()).rejects.toMatchObject({
      kind: 'internal',
      code: 'core.request_not_allowed',
    });
  });

  test('a hand-built load that claims another module as its authority is refused', async () => {
    const probe = withQuery(
      'forgedLoad',
      forged('load', {
        module: 'core',
        entity: 'tenant',
        op: 'count',
        args: [],
        view: 'module',
        forUpdate: false,
        authority: 'core',
      }),
    );
    const { run } = runnable({ registry: probe.registry, action: probe.ref });
    await expect(run()).rejects.toMatchObject({
      kind: 'internal',
      code: 'core.request_not_allowed',
      message: expect.stringContaining('neither the module itself nor one of its dependencies'),
    });
  });

  test('the read context has no id, random or issue constructor', async () => {
    const probe = withQuery('shape', (_input: unknown, ctx: ProbeContext) => ({
      newId: typeof ctx.newId,
      random: typeof ctx.random,
      issue: typeof ctx.secrets.issue,
      write: typeof ctx.write,
      reveal: typeof ctx.secrets.reveal,
      frozen: Object.isFrozen(ctx),
    }));
    const { run } = runnable({ registry: probe.registry, action: probe.ref });
    expect((await run()).output).toEqual({
      newId: 'undefined',
      random: 'undefined',
      issue: 'undefined',
      write: 'undefined',
      reveal: 'function',
      frozen: true,
    });
  });

  test('a promise from the handler is refused', async () => {
    const probe = withQuery('async', (async () => 1) as unknown as ActionEntry['handler']);
    const { run } = runnable({ registry: probe.registry, action: probe.ref });
    await expect(run()).rejects.toMatchObject({ code: 'core.request_not_allowed' });
  });

  test('a command and an unknown action are not read', async () => {
    const { run } = runnable({ action: 'library.addBook' });
    await expect(run()).rejects.toMatchObject({ code: 'core.request_not_allowed' });
    const unknown = runnable({ action: 'library.nothing' });
    await expect(unknown.run()).rejects.toMatchObject({ code: 'core.not_implemented' });
  });
});
