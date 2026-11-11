import { readFileSync } from 'node:fs';
import { splitHash } from '@keelwerk/core';
import { expect, test } from 'vitest';
import {
  asOperator,
  bootTargeting,
  callAs,
  flagEventsOf,
  setFlag,
  storedFlag,
} from './support/targeting-kit.ts';

const second = { seconds: 1 } as const;
const range = 2 ** 32;

/** A value as JSON text would carry it, the ids the test does not control replaced by `ids`. */
function plain(value: unknown, ids: ReadonlyMap<string, string>): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, member: unknown) =>
      typeof member === 'string'
        ? [...ids].reduce((text, [id, name]) => text.replaceAll(id, name), member)
        : member,
    ),
  );
}

function golden(name: string, value: unknown): void {
  const path = new URL(`./golden/${name}.json`, import.meta.url);
  expect(value).toEqual(JSON.parse(readFileSync(path, 'utf8')));
}

test('an operator enables a release flag for one tenant; within a second that tenant sees it and the other does not', async () => {
  const runtime = await bootTargeting();
  const { acme } = runtime.tenants;
  const set = await setFlag(runtime, {
    key: 'rollout.beta',
    targeting: {
      enabled: true,
      rules: [{ id: 'pilot', tenants: [acme.id], serve: { value: true } }],
      fallthrough: { value: false },
    },
    reason: 'pilot tenant',
  });
  expect(set).toMatchObject({ ok: true, value: { ruleVersion: 1 } });
  await runtime.advanceTo(runtime.clock.now().add(second));
  expect(await callAs(runtime, 'acme', 'rollout.readBeta', { text: 'a' })).toMatchObject({
    ok: true,
    value: { beta: true },
  });
  expect(await callAs(runtime, 'globex', 'rollout.readBeta', { text: 'g' })).toMatchObject({
    ok: true,
    value: { beta: false },
  });
  const [acmeEvent] = await flagEventsOf(runtime, 'acme');
  expect(acmeEvent?.flags).toEqual([
    { key: 'rollout.beta', variant: 'true', reason: 'TARGETING_MATCH', ruleVersion: 1 },
  ]);
  const [globexEvent] = await flagEventsOf(runtime, 'globex');
  expect(globexEvent?.flags).toEqual([
    { key: 'rollout.beta', variant: 'false', reason: 'STATIC', ruleVersion: 1 },
  ]);
});

test('a 30 % split over client ids keeps every key when raised to 50 %', async () => {
  const runtime = await bootTargeting();
  const targeting = (compact: number) => ({
    enabled: true,
    rules: [],
    fallthrough: {
      split: [
        { value: 'control', weight: 10_000 - compact },
        { value: 'compact', weight: compact },
      ],
    },
  });
  const clients = Array.from({ length: 200 }, (_, n) => `client-${n}`);
  const compactOf = async (): Promise<ReadonlySet<string>> => {
    const members = new Set<string>();
    for (const clientId of clients) {
      const outcome = await callAs(
        runtime,
        'acme',
        'core.flag.evaluate',
        { key: 'rollout.layout' },
        { anonymous: true, clientId },
      );
      if (!outcome.ok) throw outcome.error;
      if (outcome.value.value === 'compact') members.add(clientId);
    }
    return members;
  };
  const expected = (compact: number): ReadonlySet<string> =>
    new Set(
      clients.filter(
        (clientId) => splitHash('rollout.layout', clientId) * 10_000 >= (10_000 - compact) * range,
      ),
    );
  await setFlag(runtime, { key: 'rollout.layout', targeting: targeting(3000), reason: 'start' });
  await runtime.advanceTo(runtime.clock.now().add(second));
  const thirty = await compactOf();
  expect(thirty).toEqual(expected(3000));
  expect(thirty.size).toBeGreaterThan(30);
  expect(thirty.size).toBeLessThan(90);
  await setFlag(runtime, { key: 'rollout.layout', targeting: targeting(5000), reason: 'raise' });
  await runtime.advanceTo(runtime.clock.now().add({ seconds: 2 }));
  const fifty = await compactOf();
  expect(fifty).toEqual(expected(5000));
  for (const clientId of thirty) expect(fifty.has(clientId)).toBe(true);
  expect(fifty.size).toBeGreaterThan(thirty.size);
});

test('core.flag.evaluate answers a client flag and refuses a server-only key exactly as an unknown key', async () => {
  const runtime = await bootTargeting();
  const ask = (key: string) =>
    callAs(runtime, 'acme', 'core.flag.evaluate', { key }, { anonymous: true, clientId: 'c-1' });
  expect(await ask('rollout.layout')).toMatchObject({
    ok: true,
    value: { key: 'rollout.layout', value: 'control', variant: 'control', reason: 'DEFAULT' },
  });
  const serverOnly = await ask('rollout.hidden');
  const unknown = await ask('rollout.nothing');
  expect(serverOnly).toMatchObject({
    ok: false,
    error: { kind: 'not_found', code: 'core.not_found' },
  });
  expect(unknown).toMatchObject({
    ok: false,
    error: { kind: 'not_found', code: 'core.not_found' },
  });
  const text = (outcome: typeof serverOnly, key: string): string =>
    outcome.ok ? '' : outcome.error.message.replace(key, '<key>');
  expect(text(serverOnly, 'rollout.hidden')).toBe(text(unknown, 'rollout.nothing'));
  const withClient = await ask('rollout.layout');
  expect(withClient.ok && Object.keys(withClient.value).sort()).toEqual([
    'key',
    'reason',
    'value',
    'variant',
  ]);
});

const layoutTargeting = {
  enabled: true,
  rules: [
    {
      id: 'staff',
      when: { principalRoles: { contains: 'staff' } },
      serve: { value: 'compact', variant: 'compact' },
    },
  ],
  fallthrough: {
    split: [
      { value: 'control', weight: 9000 },
      { value: 'compact', weight: 1000 },
    ],
    salt: 'exp:layout:1',
  },
};

/** Writes the layout flag (for the backend when `forBackend`, else deployment-wide) and compares the raw row and created event with two goldens. */
async function storedFormat(name: string, forBackend: boolean): Promise<void> {
  const fixed = Temporal.Instant.from('2026-11-11T08:00:00Z');
  const runtime = await bootTargeting({ clock: { now: () => fixed } });
  const set = await setFlag(runtime, {
    key: 'rollout.layout',
    ...(forBackend ? { backendId: runtime.backendId } : {}),
    targeting: layoutTargeting,
    reason: 'start the layout test',
  });
  if (!set.ok) throw set.error;
  const ids = new Map([
    [set.value.id, '<flag id>'],
    [runtime.backendId, '<backend id>'],
  ]);
  const { row, events } = await storedFlag(runtime, set.value.id);
  const [created] = events;
  expect(events).toHaveLength(1);
  golden(`${name}-row`, plain(row, ids));
  golden(`${name}-created-event-data`, plain(created?.data, ids));
  // The projections hold the same targeting.
  const read = await asOperator(runtime, 'core.flag.get', { ids: [set.value.id] });
  expect(read.ok && (read.value.list as { targeting: unknown }[])[0]?.targeting).toEqual(
    layoutTargeting,
  );
}

test('the stored core.flag row and its created event data match their goldens (deployment-wide slot)', async () => {
  await storedFormat('flag', false);
});

test('the stored core.flag row and its created event data match their goldens (backend slot)', async () => {
  await storedFormat('flag-backend', true);
});

test('the stored core.flag row and the data of its updated events, after a second set and after a restore, match their goldens', async () => {
  const fixed = Temporal.Instant.from('2026-11-11T08:00:00Z');
  const runtime = await bootTargeting({ clock: { now: () => fixed } });
  const first = await setFlag(runtime, {
    key: 'rollout.layout',
    targeting: layoutTargeting,
    reason: 'start the layout test',
  });
  if (!first.ok) throw first.error;
  const { id } = first.value;
  const ids = new Map([[id, '<flag id>']]);
  const changed = {
    enabled: true,
    rules: [],
    fallthrough: { value: 'control', variant: 'control' },
  };
  const second = await setFlag(runtime, {
    key: 'rollout.layout',
    targeting: changed,
    reason: 'pull the layout test back',
  });
  expect(second).toMatchObject({ ok: true, value: { id, ruleVersion: 2 } });
  const afterSet = await storedFlag(runtime, id);
  const restored = await asOperator(runtime, 'core.flag.restoreRules', {
    id,
    ifVersion: 2,
    reason: 'the layout test goes on',
  });
  expect(restored).toMatchObject({ ok: true });
  const afterRestore = await storedFlag(runtime, id);
  expect(afterSet.events).toHaveLength(2);
  expect(afterRestore.events).toHaveLength(3);
  golden('flag-updated-row', {
    afterSet: plain(afterSet.row, ids),
    afterRestore: plain(afterRestore.row, ids),
  });
  golden('flag-updated-event-data', {
    set: plain(afterRestore.events[1]?.data, ids),
    restore: plain(afterRestore.events[2]?.data, ids),
  });
});
