import { renderTypeId } from '@keelwerk/core';
import { describe, expect, test, vi } from 'vitest';
import { testPrincipalHeader } from '../../src/harness/test-principal-header.ts';
import { dispatchUrl } from './support/dispatch-app.ts';
import { dispatchRuntime } from './support/dispatch-runtime.ts';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });

describe.each(['memory', 'pglite'] as const)('external performers on %s', (adapter) => {
  const { start } = dispatchRuntime(adapter);

  test('a performer follows its pending effects over SSE, settles one through report, and the continuation runs', async () => {
    const { runtime, call, follow, rows, sent } = await start();
    const first = await sent({ parcel: 'p-1' });
    expect(first.outcome).toMatchObject({ ok: true });
    const stream = await follow('north');
    try {
      expect((await stream.next())?.event).toBe('welcome');
      const items = await stream.until((frame) => frame.event === 'head');
      const data = items.filter((frame) => frame.event === 'data');
      expect(data).toHaveLength(1);
      expect(data[0]?.data).toMatchObject({
        id: renderTypeId('eff', first.id),
        parcel: 'p-1',
        depot: 'north',
      });
      const second = await sent({ parcel: 'p-2' });
      const live = await stream.next();
      expect(live?.event).toBe('data');
      expect(live?.data).toMatchObject({ id: renderTypeId('eff', second.id), parcel: 'p-2' });
      const reported = await call('dispatch.report', {
        effectId: first.id,
        ok: true,
        tracking: 'T-1',
      });
      expect(reported).toMatchObject({ ok: true });
      await runtime.drainJobs();
      expect(await rows('dispatch.delivery')).toEqual([
        expect.objectContaining({ parcel: 'p-1', ok: true, tracking: 'T-1' }),
      ]);
      const [effect] = (await rows('core.effect')).filter((row) => row.id === first.id);
      expect(effect).toMatchObject({ status: 'succeeded', performer: 'external' });
    } finally {
      await stream.close();
    }
  });

  test('the pending effects resume from a state token and replay only what came after', async () => {
    const { follow, sent } = await start();
    const first = await sent({ parcel: 'p-1' });
    const stream = await follow('north');
    let token: string | undefined;
    try {
      await stream.next();
      const items = await stream.until((frame) => frame.event === 'head');
      token = items.find((frame) => frame.event === 'head')?.id;
      expect(token).toBeTruthy();
    } finally {
      await stream.close();
    }
    const second = await sent({ parcel: 'p-2' });
    const resumed = await follow('north', {
      ...(token === undefined ? {} : { lastEventId: token }),
    });
    try {
      await resumed.next();
      const frames = await resumed.until((frame) => frame.event === 'head');
      const ids = frames
        .filter((frame) => frame.event === 'data')
        .map((frame) => (frame.data as { id: string }).id);
      expect(ids).toEqual([renderTypeId('eff', second.id)]);
      expect(ids).not.toContain(renderTypeId('eff', first.id));
    } finally {
      await resumed.close();
    }
  });

  test('a pending effect of another depot never reaches the stream', async () => {
    const { follow, sent } = await start();
    await sent({ parcel: 'p-south', depot: 'south' });
    const stream = await follow('north');
    try {
      await stream.next();
      const frames = await stream.until((frame) => frame.event === 'head');
      expect(frames.filter((frame) => frame.event === 'data')).toEqual([]);
      await sent({ parcel: 'p-south-2', depot: 'south' });
      const mine = await sent({ parcel: 'p-north', depot: 'north' });
      const next = await stream.next();
      expect(next?.data).toMatchObject({ id: renderTypeId('eff', mine.id), depot: 'north' });
    } finally {
      await stream.close();
    }
  });

  test('a settle of a settled effect answers conflict, and a repeat with the same command id answers the first outcome', async () => {
    const { call, rows, runtime, sent } = await start();
    const { id } = await sent();
    const commandId = crypto.randomUUID();
    const settled = await call(
      'dispatch.report',
      { effectId: id, ok: true, tracking: 'T-1' },
      { commandId },
    );
    expect(settled).toMatchObject({ ok: true });
    const again = await call(
      'dispatch.report',
      { effectId: id, ok: true, tracking: 'T-1' },
      { commandId },
    );
    expect(again).toMatchObject({ ...settled, replayed: true });
    const second = await call('dispatch.report', { effectId: id, ok: true, tracking: 'T-2' });
    expect(second).toMatchObject({ ok: false, error: { kind: 'conflict' } });
    await runtime.drainJobs();
    expect(await rows('dispatch.delivery')).toHaveLength(1);
    const [effect] = (await rows('core.effect')).filter((row) => row.id === id);
    expect(effect?.output).toMatchObject({ tracking: 'T-1' });
  });

  test('an output over 64 KiB is refused with core.effect_output_too_large and leaves no settled record', async () => {
    const { call, rows, runtime, sent } = await start();
    const { id } = await sent();
    const outcome = await call('dispatch.report', {
      effectId: id,
      ok: true,
      tracking: 'x'.repeat(70_000),
    });
    expect(outcome).toMatchObject({ ok: false, error: { code: 'core.effect_output_too_large' } });
    await runtime.drainJobs();
    const [effect] = (await rows('core.effect')).filter((row) => row.id === id);
    expect(effect?.status).toBe('requested');
    expect(await rows('dispatch.delivery')).toEqual([]);
  });

  test('a performer of another module cannot settle: not found', async () => {
    const { call, sent, rows } = await start();
    const { id } = await sent();
    const outcome = await call('rogue.settleIt', { effectId: id });
    expect(outcome).toMatchObject({ ok: false, error: { kind: 'not_found' } });
    const [effect] = (await rows('core.effect')).filter((row) => row.id === id);
    expect(effect?.status).toBe('requested');
  });

  test('a performer of another tenant sees no pending effect and cannot settle one', async () => {
    const { call, follow, sent, runtime } = await start();
    const globex = runtime.tenants.globex;
    const { id } = await sent();
    const stream = await follow('north', { tenant: globex });
    try {
      await stream.next();
      const frames = await stream.until((frame) => frame.event === 'head');
      expect(frames.filter((frame) => frame.event === 'data')).toEqual([]);
    } finally {
      await stream.close();
    }
    const outcome = await call(
      'dispatch.report',
      { effectId: id, ok: true, tracking: 'T' },
      { tenant: globex },
    );
    expect(outcome).toMatchObject({ ok: false, error: { kind: 'not_found' } });
  });

  test('no rule reads an effect: the submitter and another user are both forbidden', async () => {
    const { call, sent } = await start();
    const { id } = await sent({}, { as: 'ada' });
    for (const as of ['ada', 'bob']) {
      expect(await call('core.effect.get', { ids: [id] }, { as })).toMatchObject({
        ok: false,
        error: { kind: 'forbidden', code: 'core.forbidden', rules: [] },
      });
    }
  });

  test('no plaintext of the personal member reaches a frame, a log line or an error', async () => {
    const { call, follow, lines, rows, sent, runtime, acme } = await start();
    const secret = 'ada.private@example.org';
    const { id } = await sent({ recipient: secret });
    const raw = await runtime.fetch(
      new Request(
        `${dispatchUrl}/_keelwerk/v1/subscribe?action=dispatch.pending&input=${encodeURIComponent(JSON.stringify({ depot: 'north' }))}`,
        {
          headers: {
            'x-tenant': acme.id,
            [testPrincipalHeader]: JSON.stringify({ subject: 'courier', roles: [], claims: {} }),
          },
        },
      ),
    );
    const reader = raw.body?.getReader();
    const decoder = new TextDecoder();
    let text = '';
    for (let rounds = 0; rounds < 20 && !text.includes('event: head'); rounds += 1) {
      const chunk = await reader?.read();
      if (chunk === undefined || chunk.done) break;
      text += decoder.decode(chunk.value);
    }
    await reader?.cancel();
    expect(text).toContain(renderTypeId('eff', id));
    expect(text).not.toContain(secret);
    expect(text).not.toContain('$kwe');
    expect(text).not.toContain('recipient');
    const errors: unknown[] = [];
    errors.push(
      await call('dispatch.report', {
        effectId: id,
        ok: false,
        code: 'dispatch.lost',
        message: secret,
      }),
    );
    errors.push(await call('dispatch.report', { effectId: id, ok: true, tracking: secret }));
    errors.push(await call('rogue.settleIt', { effectId: id }));
    errors.push(await call('dispatch.report', { effectId: 'nope', ok: true, tracking: secret }));
    const stream = await follow('north');
    await stream.close();
    await runtime.drainJobs();
    const everything = JSON.stringify([errors, lines]);
    expect(everything).not.toContain(secret);
    expect(everything).not.toContain('$kwe');
    const [effect] = (await rows('core.effect')).filter((row) => row.id === id);
    expect(JSON.stringify(effect?.error ?? null)).not.toContain(secret);
  });
});
