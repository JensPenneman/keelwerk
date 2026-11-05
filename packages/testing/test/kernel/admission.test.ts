import type { AdmissionInput, KeyService } from '@keelwerk/core';
import {
  createCommandRunner,
  entityBehavioursOf,
  errors,
  field,
  KeelwerkError,
  shape,
} from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { conformanceApp } from '../../src/fixtures/index.ts';
import { bootKeys, storedName, withAddress, withRules } from './support/admission-kit.ts';
import { bookEntity, loanEntity, withCommand } from './support/command-kit.ts';
import {
  ada,
  base,
  call,
  failure,
  kit,
  otherTenantId,
  publicQuery,
} from './support/invoker-kit.ts';
import { backend, namespace, open, tenant } from './support/run-read-kit.ts';

/** A rule limiting each address to two calls of an action and each identifier to two failed attempts. */
const rule = (input: AdmissionInput) => {
  const address = input.request.connection?.remote.address ?? 'none';
  const who = (input.input as { who?: string } | undefined)?.who ?? 'nobody';
  return {
    kind: 'charge' as const,
    demand: {
      admit: [{ bucket: `address:${input.action}:${address}`, capacity: 2, refillPerSecond: 0.5 }],
      onDeclaredError: [{ bucket: `identifier:${who}`, capacity: 2, refillPerSecond: 0.01 }],
    },
  };
};

const ran = { wrong: 0 };

const wrongError = () =>
  new KeelwerkError({ kind: 'conflict', code: 'library.wrong', message: 'wrong' });

async function setup(rules: readonly unknown[] = [rule]) {
  const keys = await bootKeys();
  const wrong = publicQuery(
    'wrongPassword',
    // biome-ignore lint/correctness/useYield: a handler that loads nothing
    function* () {
      ran.wrong += 1;
      throw wrongError();
    },
    { errors: ['library.wrong'], input: shape({ who: field.string() }) },
  );
  const fine = publicQuery(
    'fine',
    // biome-ignore lint/correctness/useYield: a handler that loads nothing
    function* () {
      return {};
    },
    { input: shape({ who: field.string() }) },
    wrong.registry,
  );
  const elsewhere = publicQuery(
    'elsewhere',
    // biome-ignore lint/correctness/useYield: a handler that loads nothing
    function* () {
      return {};
    },
    { input: shape({ who: field.string() }) },
    fine.registry,
  );
  const inBackend = publicQuery(
    'inBackend',
    // biome-ignore lint/correctness/useYield: a handler that loads nothing
    function* () {
      return {};
    },
    { input: shape({ who: field.string() }), scope: 'backend' },
    elsewhere.registry,
  );
  return {
    keys,
    ...kit({ registry: withRules(inBackend.registry, rules), keys }),
    wrong: wrong.ref,
    fine: fine.ref,
    elsewhere: elsewhere.ref,
    inBackend: inBackend.ref,
  };
}

const asOther = { ...ada, headers: { ...ada.headers, 'x-tenant': otherTenantId } };

/** Whether the keyed bucket is full: a probe takes its whole capacity (and so drains it when it is). */
const isFull = (
  keys: KeyService,
  adapter: ReturnType<typeof kit>['adapter'],
  scope: typeof tenant,
  name: string,
  capacity: number,
  refillPerSecond: number,
) =>
  storedName(keys, scope, name).then((stored) =>
    adapter.unit(namespace, scope, (unit) =>
      unit.buckets.take(stored, capacity, { capacity, refillPerSecond }),
    ),
  );

describe('admission rules', () => {
  test('an address over its limit answers rate_limited with retryAfter', async () => {
    const { invoker, fine, elsewhere } = await setup();
    const carrier = withAddress(ada, '203.0.113.7');
    expect((await invoker.invoke(call(fine, { who: 'x' }, { carrier }))).ok).toBe(true);
    expect((await invoker.invoke(call(fine, { who: 'x' }, { carrier }))).ok).toBe(true);
    const refused = failure(await invoker.invoke(call(fine, { who: 'x' }, { carrier })));
    expect(refused.kind).toBe('rate_limited');
    expect(refused.code).toBe('core.rate_limited');
    expect(refused.retryAfter).toBe(2);
    const otherAddress = withAddress(ada, '203.0.113.8');
    expect((await invoker.invoke(call(fine, { who: 'x' }, { carrier: otherAddress }))).ok).toBe(
      true,
    );
    // the rule keys by action: another action from the refused address is still admitted
    expect((await invoker.invoke(call(elsewhere, { who: 'x' }, { carrier }))).ok).toBe(true);
  });

  test('the other tenant keeps its own tokens', async () => {
    const { invoker, fine } = await setup();
    const mine = withAddress(ada, '203.0.113.7');
    const theirs = withAddress(asOther, '203.0.113.7');
    for (let n = 0; n < 2; n++) await invoker.invoke(call(fine, { who: 'x' }, { carrier: mine }));
    expect(failure(await invoker.invoke(call(fine, { who: 'x' }, { carrier: mine }))).kind).toBe(
      'rate_limited',
    );
    expect((await invoker.invoke(call(fine, { who: 'x' }, { carrier: theirs }))).ok).toBe(true);
  });

  test('a failure-only bucket counts declared failures, not successes or undeclared failures', async () => {
    const { keys, adapter, invoker, wrong, fine } = await setup();
    const a = (n: number) => withAddress(ada, `198.51.100.${n}`);
    const attempt = (n: number, who = 'ada') =>
      invoker.invoke(call(wrong, { who }, { carrier: a(n) }));
    for (let n = 1; n <= 2; n++) expect(failure(await attempt(n)).code).toBe('library.wrong');
    // two declared failures drained the identifier's bucket (capacity 2)
    expect((await isFull(keys, adapter, tenant, 'identifier:ada', 1, 0.01)).ok).toBe(false);
    // a success never charges it
    expect((await invoker.invoke(call(fine, { who: 'bob' }, { carrier: a(9) }))).ok).toBe(true);
    expect((await isFull(keys, adapter, tenant, 'identifier:bob', 2, 0.01)).ok).toBe(true);
    // a validation error is undeclared: it fails before the rule's input exists, and charges nothing
    expect(failure(await invoker.invoke(call(wrong, { who: 1 }, { carrier: a(10) }))).kind).toBe(
      'validation',
    );
    expect((await isFull(keys, adapter, tenant, 'identifier:1', 2, 0.01)).ok).toBe(true);
  });

  test('an exhausted failure-only bucket refuses the next attempt before the action runs', async () => {
    const { invoker, wrong } = await setup([
      (input: AdmissionInput) => ({
        kind: 'charge' as const,
        demand: {
          admit: [],
          onDeclaredError: [
            {
              bucket: `identifier:${(input.input as { who: string }).who}`,
              capacity: 5,
              refillPerSecond: 0.001,
            },
          ],
        },
      }),
    ]);
    const mine = withAddress(ada, '198.51.100.30');
    ran.wrong = 0;
    for (let n = 1; n <= 5; n++) {
      expect(
        failure(await invoker.invoke(call(wrong, { who: 'ada' }, { carrier: mine }))).code,
      ).toBe('library.wrong');
    }
    expect(ran.wrong).toBe(5);
    const refused = failure(await invoker.invoke(call(wrong, { who: 'ada' }, { carrier: mine })));
    expect(refused.kind).toBe('rate_limited');
    expect(refused.retryAfter).toBeGreaterThan(0);
    // the refused attempt never reached the action, and charges nothing more
    expect(ran.wrong).toBe(5);
    // another identifier and the other tenant are unaffected
    expect(failure(await invoker.invoke(call(wrong, { who: 'bob' }, { carrier: mine }))).code).toBe(
      'library.wrong',
    );
    const theirs = withAddress(asOther, '198.51.100.30');
    expect(
      failure(await invoker.invoke(call(wrong, { who: 'ada' }, { carrier: theirs }))).code,
    ).toBe('library.wrong');
  });

  test('a command that rolls back on a declared error still counts the attempt', async () => {
    const probe = withCommand(
      'rollsBack',
      () => {
        throw wrongError();
      },
      'library.addBook',
      { errors: ['library.wrong'], input: shape({ who: field.string() }) },
    );
    const keys = await bootKeys();
    const adapter = open([bookEntity, loanEntity]);
    const { invoker } = kit({
      registry: withRules(probe.registry, [rule]),
      adapter,
      keys,
      commands: createCommandRunner({
        behaviours: () => entityBehavioursOf(conformanceApp.modules),
        retry: { sleep: async () => undefined },
      }),
    });
    const carrier = withAddress(ada, '198.51.100.20');
    expect(failure(await invoker.invoke(call(probe.ref, { who: 'cy' }, { carrier }))).code).toBe(
      'library.wrong',
    );
    expect((await isFull(keys, adapter, tenant, 'identifier:cy', 2, 0.01)).ok).toBe(false);
  });

  test('buckets are stored under a hash derived from the scope key, in the tenant or the backend', async () => {
    const { keys, invoker, adapter, wrong, inBackend } = await setup([
      (input: AdmissionInput) => ({
        kind: 'charge' as const,
        demand: {
          admit: [{ bucket: `action:${input.action}`, capacity: 1, refillPerSecond: 0.001 }],
          onDeclaredError: [
            {
              bucket: `identifier:${(input.input as { who: string }).who}`,
              capacity: 1,
              refillPerSecond: 0.001,
            },
          ],
        },
      }),
    ]);
    await invoker.invoke(call(wrong, { who: 'ada' }, { carrier: ada }));
    await invoker.invoke(call(inBackend, { who: 'ada' }, { carrier: ada }));
    const drained = async (scope: typeof tenant, name: string) =>
      (
        await adapter.unit(namespace, scope, async (unit) =>
          unit.buckets.take(await storedName(keys, scope, name), 1, {
            capacity: 1,
            refillPerSecond: 0.001,
          }),
        )
      ).ok;
    const plain = (scope: typeof tenant) =>
      adapter.unit(namespace, scope, (unit) =>
        unit.buckets.take('identifier:ada', 1, { capacity: 1, refillPerSecond: 0.001 }),
      );
    // the plain identifier names no row; the keyed hash names the drained one
    expect((await plain(tenant)).ok).toBe(true);
    expect(await drained(tenant, 'identifier:ada')).toBe(false);
    expect(await drained(tenant, `action:${wrong}`)).toBe(false);
    // a backend-scope action is charged in the backend's own scope, under the backend's key
    expect(await drained(backend, `action:${inBackend}`)).toBe(false);
    expect(await drained(tenant, `action:${inBackend}`)).toBe(true);
  });

  test('a refusal verdict of a rule is the answer', async () => {
    const { invoker, fine } = await setup([
      () => ({ kind: 'refuse' as const, error: errors.forbidden('closed') }),
    ]);
    expect(failure(await invoker.invoke(call(fine, { who: 'x' }, { carrier: ada }))).kind).toBe(
      'forbidden',
    );
  });

  test('a rule written as a generator is driven', async () => {
    const { invoker, fine } = await setup([
      // biome-ignore lint/correctness/useYield: a rule that loads nothing
      function* () {
        return {
          kind: 'charge' as const,
          demand: {
            admit: [{ bucket: 'all', capacity: 1, refillPerSecond: 0.1 }],
            onDeclaredError: [],
          },
        };
      },
    ]);
    expect((await invoker.invoke(call(fine, { who: 'x' }, { carrier: ada }))).ok).toBe(true);
    expect(failure(await invoker.invoke(call(fine, { who: 'x' }, { carrier: ada }))).kind).toBe(
      'rate_limited',
    );
  });

  test.each([
    ['no capacity', { capacity: 0, refillPerSecond: 1 }],
    ['no refill', { capacity: 1, refillPerSecond: 0 }],
    ['a cost above the capacity', { capacity: 1, refillPerSecond: 1, cost: 2 }],
  ])(
    'a bucket with %s is an internal error, at admit or on a failure-only charge',
    async (_name, limits) => {
      for (const demand of [
        { admit: [{ bucket: 'x', ...limits }], onDeclaredError: [] },
        { admit: [], onDeclaredError: [{ bucket: 'x', ...limits }] },
      ]) {
        const { invoker, fine } = await setup([() => ({ kind: 'charge' as const, demand })]);
        expect(failure(await invoker.invoke(call(fine, { who: 'x' }, { carrier: ada }))).kind).toBe(
          'internal',
        );
      }
    },
  );

  test('without rules nothing is charged', async () => {
    const { invoker, adapter } = kit({ registry: base, keys: await bootKeys() });
    await invoker.invoke(call('library.findByIsbn', { isbn: 'x' }, { carrier: ada }));
    const probe = await adapter.unit(namespace, tenant, (unit) =>
      unit.buckets.take('anything', 1, { capacity: 1, refillPerSecond: 1 }),
    );
    expect(probe.ok).toBe(true);
  });
});
