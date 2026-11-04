import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { eventsOf } from './events-of.ts';
import { flakyAdapter } from './flaky-adapter.ts';
import { rowsOf } from './rows-of.ts';
import type { SpikeKit } from './start-spike-kit.ts';
import { startSpikeKit } from './start-spike-kit.ts';

let kit: SpikeKit;
beforeAll(async () => {
  kit = await startSpikeKit();
});
afterAll(() => kit.stop());

const forms = [
  { form: 'separate', action: 'github.connect' },
  { form: 'inline', action: 'github.connectInline' },
] as const;

describe.each(forms)('GitHub connection, $form form', ({ form, action }) => {
  test('a good code and an open state store the connection and consume the start', async () => {
    const state = `ok-${form}`;
    await kit.call('separate', 'github.startConnect', { state });
    kit.trace.length = 0;
    const result = await kit.call(form, action, { code: `good-${form}`, state });
    expect(result.output).toEqual({ connectionId: expect.any(String) });
    const connections = await rowsOf(kit.world, 'github.connection');
    expect(connections.find((row) => row.state === state)).toMatchObject({
      accountLogin: 'octo-cat',
      tokenLast4: 'abcd',
      scopes: 'repo,read:org',
    });
    const starts = await rowsOf(kit.world, 'github.pendingConnect');
    expect(starts.find((row) => row.state === state)?.consumedAt).toBeDefined();
    expect(kit.calls.at(-1)).toBe(`good-${form}`);
  });

  test('every effect is requested and settled before the read-write unit opens', async () => {
    const state = `order-${form}`;
    await kit.call('separate', 'github.startConnect', { state });
    kit.trace.length = 0;
    await kit.call(form, action, { code: `good-order-${form}`, state });
    const writeUnit = kit.trace.indexOf('unit:write');
    expect(writeUnit).toBeGreaterThan(kit.trace.indexOf('effect'));
    expect(kit.trace.indexOf('claim')).toBeGreaterThan(writeUnit);
    expect(kit.trace.filter((entry) => entry === 'unit:write')).toHaveLength(1);
    expect(kit.trace.filter((entry) => entry === 'effect')).toHaveLength(1);
  });

  test('M1 holds one read-only unit open across the effect (WP-41 must close it before perform)', async () => {
    const state = `open-${form}`;
    await kit.call('separate', 'github.startConnect', { state });
    kit.trace.length = 0;
    await kit.call(form, action, { code: `good-open-${form}`, state });
    const effectAt = kit.trace.indexOf('effect');
    const before = kit.trace.slice(0, effectAt);
    const opened = before.filter((entry) => entry.startsWith('unit:') && entry !== 'unit:end');
    const closed = before.filter((entry) => entry === 'unit:end');
    // Gap 1 of REPORT.md: section 7.9.4 wants none open; WP-38 keeps one for all of prepare.
    expect(opened.length - closed.length).toBe(1);
  });

  test('a code GitHub refuses is github.exchange_failed and nothing is stored', async () => {
    const state = `refused-${form}`;
    await kit.call('separate', 'github.startConnect', { state });
    const before = (await rowsOf(kit.world, 'github.connection')).length;
    const error = await kit
      .call(form, action, { code: 'refused', state }, { commandId: `refused-${form}` })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      kind: 'unavailable',
      code: 'github.exchange_failed',
      message: 'GitHub did not accept the code.',
      details: { reason: 'The code passed is incorrect or expired.' },
    });
    expect(await rowsOf(kit.world, 'github.connection')).toHaveLength(before);
    const start = (await rowsOf(kit.world, 'github.pendingConnect')).find(
      (row) => row.state === state,
    );
    expect(start?.consumedAt).toBeUndefined();
  });
});

describe('a state that belongs to no open start', () => {
  test('the separate form refuses before it spends the code', async () => {
    const before = kit.calls.length;
    const error = await kit
      .call('separate', 'github.connect', { code: 'good-stray', state: 'stray-1' })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: 'conflict', code: 'github.state_unknown' });
    expect(kit.calls.length - before).toBe(0);
  });

  test('the inline form has already spent the code when it can check the state', async () => {
    const before = kit.calls.length;
    const error = await kit
      .call('inline', 'github.connectInline', { code: 'good-stray', state: 'stray-2' })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: 'conflict', code: 'github.state_unknown' });
    expect(kit.calls.length - before).toBe(1);
  });
});

describe('the rule of the variant', () => {
  test('an inline effect after a load is refused with core.effect_after_load and nothing is stored', async () => {
    const state = 'late-1';
    await kit.call('separate', 'github.startConnect', { state });
    const before = kit.calls.length;
    const commandId = '00000000-0000-7000-8000-00000000f001';
    const error = await kit
      .call('inline', 'github.connectLate', { code: 'good-late', state }, { commandId })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      kind: 'internal',
      code: 'core.effect_after_load',
      message:
        'github.connectLate requested the inline effect github.exchangeCode after its first load; inline effects belong before the first load of decide.',
      details: { effect: 'github.exchangeCode', action: 'github.connectLate' },
    });
    expect(kit.calls.length - before).toBe(0);
    const receipt = await kit.world.runtime.adapter.unit(
      kit.world.namespace,
      kit.world.scope,
      (unit) => unit.receipts.get(commandId),
    );
    expect(receipt).toBeUndefined();
  });

  test('the same order is legal in the separate form: load in prepare, then perform', async () => {
    const state = 'late-2';
    await kit.call('separate', 'github.startConnect', { state });
    const result = await kit.call('separate', 'github.connect', { code: 'good-late-2', state });
    expect(result.output).toEqual({ connectionId: expect.any(String) });
  });
});

describe('retries and replays', () => {
  test.each(forms)(
    'a version conflict repeats the unit, never the effect ($form)',
    async ({ form, action }) => {
      const state = `flaky-${form}`;
      await kit.call('separate', 'github.startConnect', { state });
      const before = kit.calls.length;
      kit.trace.length = 0;
      const result = await kit.call(
        form,
        action,
        { code: `good-flaky-${form}`, state },
        { wrap: (inner) => flakyAdapter(inner, 1) },
      );
      expect(result.output).toEqual({ connectionId: expect.any(String) });
      expect(kit.calls.length - before).toBe(1);
      expect(kit.trace.filter((entry) => entry === 'claim')).toHaveLength(2);
    },
  );

  test.each(forms)(
    'the same command id answers the recorded result ($form)',
    async ({ form, action }) => {
      const state = `again-${form}`;
      await kit.call('separate', 'github.startConnect', { state });
      const commandId = `00000000-0000-7000-8000-0000000a000${form === 'inline' ? 2 : 1}`;
      const input = { code: `good-again-${form}`, state };
      const first = await kit.call(form, action, input, { commandId });
      const before = kit.calls.length;
      const second = await kit.call(form, action, input, { commandId });
      expect(second.output).toEqual(first.output);
      expect(second.replayed).toBe(true);
      expect(kit.calls.length - before).toBe(0);
    },
  );

  test.each(forms)(
    'a command that failed after the effect reuses the settled record on the same id ($form)',
    async ({ form, action }) => {
      const state = `exhausted-${form}`;
      await kit.call('separate', 'github.startConnect', { state });
      const commandId = `00000000-0000-7000-8000-0000000c000${form === 'inline' ? 2 : 1}`;
      const input = { code: `good-exhausted-${form}`, state };
      const failed = await kit
        .call(form, action, input, { commandId, wrap: (inner) => flakyAdapter(inner, 4) })
        .catch((caught: unknown) => caught);
      expect(failed).toBeInstanceOf(Error);
      const before = kit.calls.length;
      const settledBefore = kit.log.records.filter((record) => record.phase === 'settled').length;
      const second = await kit.call(form, action, input, { commandId });
      expect(second.output).toEqual({ connectionId: expect.any(String) });
      expect(kit.calls.length - before).toBe(0);
      expect(kit.log.records.filter((record) => record.phase === 'settled')).toHaveLength(
        settledBefore,
      );
    },
  );
});

describe('what the record can replay', () => {
  test.each(forms)(
    'the decision record of the connection event ($form)',
    async ({ form, action }) => {
      const state = `record-${form}`;
      await kit.call('separate', 'github.startConnect', { state });
      kit.trace.length = 0;
      const commandId = `00000000-0000-7000-8000-0000000b000${form === 'inline' ? 2 : 1}`;
      const result = await kit.call(
        form,
        action,
        { code: `good-rec-${form}`, state },
        { commandId },
      );
      const { connectionId } = result.output as { connectionId: string };
      const stored = (await rowsOf(kit.world, 'github.connection')).find(
        (row) => row.id === connectionId,
      );
      expect(stored?.tokenLast4).toBe('abcd');
      const [event] = await eventsOf(kit.world, 'github.connection', connectionId);
      const decision = event?.decision;
      expect(decision?.part).toBe(action);
      expect(decision?.effects).toEqual([]);
      expect(decision?.reads).toHaveLength(1);
      expect(decision?.answers).toHaveLength(1);
      const finds = kit.trace.filter((entry) => entry === 'find').length;
      // The unit's own load and write checks are the same in both forms; the separate form adds prepare's load.
      expect(finds).toBe(form === 'separate' ? 3 : 2);
      const settled = kit.log.records.filter(
        (record) => record.phase === 'settled' && record.id.startsWith(commandId),
      );
      expect(settled).toHaveLength(1);
      const [only] = settled;
      expect(only?.phase === 'settled' ? only.outcome : undefined).toMatchObject({
        ok: true,
        value: { accountLogin: stored?.accountLogin, token: expect.stringMatching(/abcd$/) },
      });
      expect(settled.map((record) => record.id)).toEqual([`${commandId}#0`]);
    },
  );
});
