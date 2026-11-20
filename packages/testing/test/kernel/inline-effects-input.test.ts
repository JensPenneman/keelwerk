import { field, shape } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { runDirect } from './support/command-kit.ts';
import { effectEntity } from './support/effects-kit.ts';
import {
  bootPair,
  cutAfterPing,
  draftOf,
  namedPrincipal,
  type PairContext,
} from './support/inline-pair-kit.ts';
import { anonymous, namespace, tenant } from './support/run-read-kit.ts';

const mismatch = { code: 'core.idempotency_mismatch' };

/** A prepare that performs ping with the member `to` of the command input, and records each answer. */
const pingTo = (seen: unknown[]) =>
  function* (input: Readonly<Record<string, unknown>>, ctx: PairContext) {
    const outcome = yield* ctx.perform(draftOf('ping', { to: String(input.to) }));
    seen.push(outcome);
    return outcome;
  };

describe('an inline row answers the same effect input only', () => {
  test('an anonymous caller with the same command id and another input is refused, and its executor never runs', async () => {
    const seen: unknown[] = [];
    const pair = bootPair({ prepare: pingTo(seen) });
    await pair.run('c-input-1', { to: 'a@example.org' }, { principal: anonymous });
    const error = await pair
      .run('c-input-1', { to: 'b@example.org' }, { principal: anonymous })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject(mismatch);
    expect(pair.pings).toHaveLength(1);
    expect(seen).toHaveLength(1);
  });

  test('an input derived from a load that changed since is refused although the receipt is the same', async () => {
    const seen: unknown[] = [];
    const pair = bootPair({
      prepare: function* (_input, ctx) {
        const count = yield* ctx.load.library.book.count();
        const outcome = yield* ctx.perform(draftOf('ping', { to: `books-${count}` }));
        seen.push(outcome);
        return outcome;
      },
    });
    await pair.run('c-input-2', {}, { principal: namedPrincipal('ada') });
    await runDirect({
      adapter: pair.adapter,
      action: 'library.addBook',
      input: { title: 'A new book', isbn: 'isbn-new' },
    });
    const error = await pair
      .run('c-input-2', {}, { principal: namedPrincipal('ada') })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject(mismatch);
    expect(pair.pings).toHaveLength(1);
    expect(seen).toHaveLength(1);
  });

  test('the same named caller that was cut and asks again with another input is refused', async () => {
    const cut = cutAfterPing();
    const seen: unknown[] = [];
    const pair = bootPair({ prepare: pingTo(seen), onPing: cut.onPing });
    const ada = namedPrincipal('ada');
    await expect(
      pair.run('c-input-3', { to: 'a@example.org' }, { principal: ada, signal: cut.signal }),
    ).rejects.toBe(cut.reason);
    const error = await pair
      .run('c-input-3', { to: 'b@example.org' }, { principal: ada })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject(mismatch);
    expect(pair.pings).toHaveLength(1);
    // The cut run never saw an answer, and the refused one sees none.
    expect(seen).toHaveLength(0);
  });

  test('the same named caller with the same input is answered and the executor ran once', async () => {
    const seen: unknown[] = [];
    const pair = bootPair({ prepare: pingTo(seen) });
    const ada = namedPrincipal('ada');
    await pair.run('c-input-4', { to: 'a@example.org' }, { principal: ada });
    await pair.run('c-input-4', { to: 'a@example.org' }, { principal: ada });
    expect(pair.pings).toHaveLength(1);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual(seen[0]);
  });

  test('an anonymous caller with the same input is answered when the action declares no credential member', async () => {
    const seen: unknown[] = [];
    const pair = bootPair({
      prepare: pingTo(seen),
      action: { input: shape({ to: field.string() }) },
    });
    await pair.run('c-input-5', { to: 'a@example.org' }, { principal: anonymous });
    await pair.run('c-input-5', { to: 'a@example.org' }, { principal: anonymous });
    expect(pair.pings).toHaveLength(1);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual(seen[0]);
  });
});

describe('a secret member of the effect input', () => {
  const booted = () => {
    const seen: unknown[] = [];
    const pair = bootPair({
      prepare: function* (input, ctx) {
        const outcome = yield* ctx.perform(draftOf('ping', { to: 'fixed', code: input.code }));
        seen.push(outcome);
        return outcome;
      },
      ping: { input: shape({ to: field.string(), code: field.secret() }) },
    });
    return { pair, seen };
  };

  test('the same secret is answered, another is refused although the receipt hides secrets', async () => {
    const { pair, seen } = booted();
    const ada = namedPrincipal('ada');
    await pair.run('c-secret-1', { code: 'one' }, { principal: ada });
    await pair.run('c-secret-1', { code: 'one' }, { principal: ada });
    expect(pair.pings).toHaveLength(1);
    expect(seen).toHaveLength(2);
    const error = await pair
      .run('c-secret-1', { code: 'two' }, { principal: ada })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject(mismatch);
    expect(pair.pings).toHaveLength(1);
    expect(seen).toHaveLength(2);
  });

  test('an anonymous caller that repeats the finished command with the same secret is refused', async () => {
    const { pair, seen } = booted();
    await pair.run('c-secret-3', { code: 'one' }, { principal: anonymous });
    const error = await pair
      .run('c-secret-3', { code: 'one' }, { principal: anonymous })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject(mismatch);
    expect(pair.pings).toHaveLength(1);
    expect(seen).toHaveLength(1);
  });

  test('a secret whose key is gone cannot be compared and is refused', async () => {
    const { pair } = booted();
    const ada = namedPrincipal('ada');
    await pair.run('c-secret-2', { code: 'one' }, { principal: ada });
    await pair.adapter.unit(namespace, tenant, async (unit) => {
      const [row] = (await unit.rows.find(effectEntity, {})).rows;
      const text = String(((row?.input ?? {}) as { code?: string }).code);
      await unit.keys.destroyValueKey(text.split('.')[1] ?? '');
    });
    const error = await pair
      .run('c-secret-2', { code: 'one' }, { principal: ada })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject(mismatch);
    expect(pair.pings).toHaveLength(1);
  });
});

describe('a personal member of the effect input', () => {
  const personal = {
    input: shape({ owner: field.subject(), to: field.string().personal() }),
    dataSubject: 'owner',
  };
  const booted = () => {
    const cut = cutAfterPing();
    const pair = bootPair({
      prepare: function* (input, ctx) {
        return yield* ctx.perform(draftOf('ping', { owner: input.owner, to: input.to }));
      },
      ping: personal,
      onPing: cut.onPing,
    });
    return { pair, cut };
  };
  const ada = namedPrincipal('ada');

  test('the same value is answered although every seal is fresh, another value is refused', async () => {
    const { pair, cut } = booted();
    const input = { owner: 'subject-1', to: 'ada@example.org' };
    await expect(
      pair.run('c-personal-1', input, { principal: ada, signal: cut.signal }),
    ).rejects.toBe(cut.reason);
    const answered = await pair.run('c-personal-1', input, { principal: ada });
    expect(answered).toBeDefined();
    expect(pair.pings).toHaveLength(1);
  });

  test('another personal value at the same id is refused', async () => {
    const { pair, cut } = booted();
    await expect(
      pair.run(
        'c-personal-2',
        { owner: 'subject-1', to: 'ada@example.org' },
        { principal: ada, signal: cut.signal },
      ),
    ).rejects.toBe(cut.reason);
    const error = await pair
      .run('c-personal-2', { owner: 'subject-1', to: 'bea@example.org' }, { principal: ada })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject(mismatch);
    expect(pair.pings).toHaveLength(1);
  });
});

describe('a finished command of a credential action without identity', () => {
  const booted = () => {
    const seen: unknown[] = [];
    let decided = 0;
    const pair = bootPair({
      prepare: function* (input, ctx) {
        const outcome = yield* ctx.perform(draftOf('ping', { email: String(input.email) }));
        seen.push(outcome);
        return outcome;
      },
      ping: { input: shape({ email: field.string() }) },
      action: {
        input: shape({ email: field.string(), pin: field.secret() }),
        output: shape({ ok: field.boolean() }),
      },
      decide: ((
        input: { readonly pin: string },
        ctx: { readonly prepared: { value: unknown } },
      ) => {
        decided += 1;
        if (input.pin !== 'right') throw new Error('the pin is wrong');
        return { result: ctx.prepared.value };
      }) as never,
    });
    return { pair, seen, decided: () => decided };
  };

  test('is refused in prepare whatever pin the repeat carries, and nothing of the first run is answered', async () => {
    const { pair, seen, decided } = booted();
    const first = await pair.run(
      'c-pin-1',
      { email: 'a@example.org', pin: 'right' },
      { principal: anonymous },
    );
    expect(first.output).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    // The same command id, the same email and the wrong pin: the lookup is not answered from run 1.
    for (const pin of ['wrong', 'right']) {
      const error = await pair
        .run('c-pin-1', { email: 'a@example.org', pin }, { principal: anonymous })
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject(mismatch);
      expect(JSON.stringify(error)).not.toContain('true');
    }
    expect(seen).toHaveLength(1);
    expect(pair.pings).toHaveLength(1);
    expect(decided()).toBe(1);
  });
});
