import { describe, expect, test } from 'vitest';
import { storedName } from './support/admission-kit.ts';
import { deriveOnlyKeys } from './support/derive-only-keys.ts';
import { receiptOf, stored } from './support/effects-kit.ts';
import { ada } from './support/invoker-kit.ts';
import { boot } from './support/prepare-admission-world.ts';
import { tenant, userOf } from './support/run-read-kit.ts';

// The request rate counts a request where it enters (12.2). Each case sends requests through the
// kernel on the in-memory adapter, with every request rate at a capacity under 20 so that the
// allowance of the process draws the one token it spends and holds nothing, and counts the tokens
// the bucket store gave, by bucket. What decides each case: the awaited answers, the counted
// tokens and the committed store; the clock is the world's and moves only where a case moves it
// (a token takes 1,000 s to refill), and nothing runs in the background.

const adaUser = userOf('ada');
const adaSubject = adaUser.kind === 'user' ? String(adaUser.subject) : '';

/** The stored names of the three buckets of a request by `ada` to a command. */
async function bucketsOfAda() {
  const name = (ref: string, bucket = ref) => storedName(deriveOnlyKeys, tenant, bucket, 'core');
  return {
    principal: await name(
      'core.principalRequestRate',
      `core.principalRequestRate:user:${adaSubject}`,
    ),
    commands: await name('core.commandRate'),
    tenant: await name('core.requestRate'),
  };
}

/**
 * The tokens taken so far from each of the three buckets of `ada`, by name (a bucket never taken
 * from is 0), and from every other bucket together.
 */
async function tokensOf(taken: () => ReadonlyMap<string, number>) {
  const names = await bucketsOfAda();
  const counts = taken();
  const own = { principal: 0, commands: 0, tenant: 0 };
  let others = 0;
  for (const [bucket, tokens] of counts) {
    const mine = (Object.keys(names) as (keyof typeof names)[]).find(
      (kind) => names[kind] === bucket,
    );
    if (mine === undefined) others += tokens;
    else own[mine] += tokens;
  }
  return { ...own, others };
}

const none = { principal: 0, commands: 0, tenant: 0, others: 0 };
const once = { principal: 1, commands: 1, tenant: 1, others: 0 };
const twice = { principal: 2, commands: 2, tenant: 2, others: 0 };
const bea = { ...ada, headers: { ...ada.headers, authorization: 'Bearer tok-bea' } };
const id = (n: number) => `00000000-0000-7000-8000-0000000003${String(n).padStart(2, '0')}`;

describe('where the request rate counts (section 12.2)', () => {
  test('a request whose command prepares, runs an inline effect, nests a command and triggers an inline reaction takes one token of each bucket', async () => {
    const { world, adapter, invoke, taken } = boot({ relay: true, rates: {} });
    const answer = await invoke('library.relay', { title: 'Relayed', isbn: 'n-1' });
    expect(answer.ok).toBe(true);
    // The command prepared (its inline effect ran once), invoked `library.grow` for `n-1` (nested
    // by the decision) and its inline reaction invoked `library.grow` again for `rl-1` (nested by
    // a reaction): four paths that run commands or effects, and one request.
    expect(world.runs).toBe(1);
    expect((await stored(adapter)).books.map((book) => book.isbn).sort()).toEqual(['n-1', 'rl-1']);
    expect(await tokensOf(taken)).toEqual(once);
  });

  test('a command nested two deep takes nothing of its own', async () => {
    const { adapter, invoke, taken } = boot({ rates: {} });
    expect((await invoke('library.relayDeep', { title: 'Deep', isbn: 'n-1' })).ok).toBe(true);
    expect((await stored(adapter)).books.map((book) => book.isbn)).toEqual(['n-1']);
    expect(await tokensOf(taken)).toEqual(once);
  });

  test('a resend of a command id takes one more token and gets its receipt', async () => {
    const { world, adapter, invoke, taken } = boot({ rates: {} });
    const first = await invoke(
      'library.stock',
      { title: 'Once', isbn: 's-1' },
      { commandId: id(1) },
    );
    expect(first.ok).toBe(true);
    expect(await tokensOf(taken)).toEqual(once);
    const again = await invoke(
      'library.stock',
      { title: 'Once', isbn: 's-1' },
      { commandId: id(1) },
    );
    expect(again).toEqual({ ...first, replayed: true });
    expect(await tokensOf(taken)).toEqual(twice);
    expect(world.runs).toBe(1);
    expect((await stored(adapter)).books).toHaveLength(1);
    expect(await receiptOf(adapter, id(1))).toMatchObject({ status: 'completed' });
  });

  test('a resend against an empty bucket gets rate_limited, takes nothing, and gets its receipt once the bucket has refilled', async () => {
    const { world, invoke, taken } = boot({ rates: { 'core.requestRate': 2 } });
    const first = await invoke(
      'library.stock',
      { title: 'Once', isbn: 's-1' },
      { commandId: id(2) },
    );
    expect(first.ok).toBe(true);
    expect(
      (await invoke('library.stock', { title: 'Once', isbn: 's-1' }, { commandId: id(2) })).ok,
    ).toBe(true);
    expect(await tokensOf(taken)).toEqual(twice);
    // The tenant's bucket is empty: the principal's and the class's gave nothing either.
    const refused = await invoke(
      'library.stock',
      { title: 'Once', isbn: 's-1' },
      { commandId: id(2) },
    );
    expect(refused).toMatchObject({
      ok: false,
      error: { code: 'core.rate_limited', retryAfter: 1000 },
    });
    expect(await tokensOf(taken)).toEqual(twice);
    // A refusal by the rate is pinned to nothing: the same id, sent again after the refill, is
    // judged anew and gets the receipt of its first run.
    world.now = world.now.add({ seconds: 1000 });
    const later = await invoke(
      'library.stock',
      { title: 'Once', isbn: 's-1' },
      { commandId: id(2) },
    );
    expect(later).toEqual({ ...first, replayed: true });
    expect(await tokensOf(taken)).toEqual({ principal: 3, commands: 3, tenant: 3, others: 0 });
    expect(world.runs).toBe(1);
  });

  test('a request that the storage admission of a command with prepare refuses has spent its tokens', async () => {
    const { world, invoke, taken } = boot({ rates: {} });
    expect((await invoke('library.grow', { isbn: 'g-1' })).ok).toBe(true);
    expect(await tokensOf(taken)).toEqual(once);
    // One row is stored and the limit is 0: the storage admission refuses before `prepare` runs.
    world.rows = 0;
    const refused = await invoke('library.probe', {}, { commandId: id(3) });
    expect(refused).toMatchObject({ ok: false, error: { code: 'core.quota_exceeded' } });
    expect(world.runs).toBe(0);
    expect(await tokensOf(taken)).toEqual(twice);
  });

  test('a request that validation refuses has spent its tokens', async () => {
    const { invoke, taken } = boot({ rates: {} });
    const refused = await invoke('library.grow', { n: 'not a number' });
    expect(refused).toMatchObject({ ok: false, error: { kind: 'validation' } });
    expect(await tokensOf(taken)).toEqual(once);
  });

  test('a request that authorization refuses has spent its tokens', async () => {
    const { invoke, taken } = boot({ rates: {} });
    const refused = await invoke('library.guarded', {});
    expect(refused).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
    expect(await tokensOf(taken)).toEqual(once);
  });

  test('a request whose rate unit finds the store away gets core.unavailable and takes nothing, and the next is admitted', async () => {
    const { invoke, taken, away } = boot({ rates: {} });
    away('unit');
    const refused = await invoke('library.grow', { isbn: 'g-1' });
    expect(refused).toMatchObject({
      ok: false,
      error: { kind: 'unavailable', code: 'core.unavailable', retryable: true },
    });
    expect(await tokensOf(taken)).toEqual(none);
    expect((await invoke('library.grow', { isbn: 'g-1' })).ok).toBe(true);
    expect(await tokensOf(taken)).toEqual(once);
  });

  test('a store that goes away inside the unit refuses the request with core.unavailable and gives back the tokens it held', async () => {
    // Capacities of 100: the second request of `ada` draws 10 tokens of each bucket and holds 9.
    const { invoke, taken, away } = boot({
      rates: { 'core.requestRate': 100, 'core.commandRate': 100, 'core.principalRequestRate': 100 },
    });
    for (let n = 0; n < 2; n += 1)
      expect((await invoke('library.grow', { isbn: `a-${n}` })).ok).toBe(true);
    const warm = await tokensOf(taken);
    expect(warm).toEqual({ principal: 11, commands: 11, tenant: 11, others: 0 });
    // `bea` has no token held of her own principal bucket, so her request goes to the store, takes
    // the held tokens of the class and the tenant first, and fails at its first take.
    away('take');
    const refused = await invoke('library.grow', { isbn: 'b-1' }, { carrier: bea });
    expect(refused).toMatchObject({
      ok: false,
      error: { kind: 'unavailable', code: 'core.unavailable' },
    });
    expect(await tokensOf(taken)).toEqual(warm);
    expect((await invoke('library.grow', { isbn: 'b-1' }, { carrier: bea })).ok).toBe(true);
    // `bea` took 1 of her own principal bucket and the held tokens of the class and the tenant that the
    // failed request had put back: 8 are left of 9, and `ada` spends them with no trip to the store.
    expect(await tokensOf(taken)).toEqual({ principal: 11, commands: 11, tenant: 11, others: 1 });
    for (let n = 0; n < 8; n += 1)
      expect((await invoke('library.grow', { isbn: `a-${n + 2}` })).ok).toBe(true);
    expect(await tokensOf(taken)).toEqual({ principal: 11, commands: 11, tenant: 11, others: 1 });
  });
});
