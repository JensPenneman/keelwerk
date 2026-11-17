import { entityBehavioursOf, renderTypeId } from '@keelwerk/core';
import { seedRows } from '@keelwerk/core/replay';
import { describe, expect, test, vi } from 'vitest';
import { testPrincipalHeader } from '../../src/harness/test-principal-header.ts';
import { dispatchApp, dispatchUrl } from './support/dispatch-app.ts';
import { changesOf, dispatchRuntime, dispatchSoon } from './support/dispatch-runtime.ts';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });

const statusKeys = ['id', 'requestedAt', 'status', 'type'];
/** The result of a successful call over HTTP: the envelope's `value`. */
const resultOf = (answer: { readonly json: unknown }): Record<string, unknown> =>
  (answer.json as { value: Record<string, unknown> }).value;

const secrets = [
  'p-1',
  'north',
  'ada@example.org',
  '$kwe',
  'continuation',
  'dispatch.shipped',
  'commandId',
  'attempts',
  'eventIds',
  'performer',
  'principalResolver',
  'principalId',
  'test.principal',
  'T-secret-tracking',
  'continuationWith',
  'outputDigest',
];

describe.each(['memory', 'pglite'] as const)('the status of an effect on %s', (adapter) => {
  const { start } = dispatchRuntime(adapter);

  test('the submitter reads the status of the effect its command requested', async () => {
    const booted = await start();
    const { post, sent, call } = booted;
    const { id, outcome } = await sent();
    // The id comes from the command's answer, as a client reads it, and is rendered for the wire.
    const listed = outcome.ok ? outcome.effects?.[0] : undefined;
    expect(listed).toBeDefined();
    expect(listed).toBe(id);
    const wire = renderTypeId('eff', listed ?? '');
    const requested = await post('core.effectStatus', { id: wire });
    expect(requested.status).toBe(200);
    expect(resultOf(requested)).toMatchObject({
      id: wire,
      type: 'dispatch.ship',
      status: 'requested',
    });
    expect(Object.keys(resultOf(requested))).toEqual(expect.arrayContaining(statusKeys));
    expect(resultOf(requested)).not.toHaveProperty('settledAt');
    expect(
      await call('dispatch.report', { effectId: id, ok: true, tracking: 'T-secret-tracking' }),
    ).toMatchObject({ ok: true });
    const settled = await post('core.effectStatus', { id: wire });
    expect(resultOf(settled)).toMatchObject({ id: wire, status: 'succeeded' });
    expect(resultOf(settled)).toHaveProperty('settledAt');
    expect(resultOf(settled)).not.toHaveProperty('error');
  });

  test('an effect past its deadline shows failed with core.effect_deadline and its kind only', async () => {
    const booted = await start();
    const { post, sent, runtime } = booted;
    const deadline = dispatchSoon(booted);
    const { id } = await sent({ deadline });
    await runtime.advanceTo(deadline.add({ seconds: 1 }));
    await runtime.drainJobs();
    expect(await changesOf(booted, id)).toEqual(['core.effect.created', 'core.effect.changed']);
    const failed = await post('core.effectStatus', { id: renderTypeId('eff', id) });
    expect(resultOf(failed)).toMatchObject({
      status: 'failed',
      error: { kind: 'unavailable', code: 'core.effect_deadline' },
    });
    expect(resultOf(failed).error).toEqual({
      kind: 'unavailable',
      code: 'core.effect_deadline',
    });
    expect(resultOf(failed)).toHaveProperty('deadline');
  });

  test('another user, another tenant and an unknown id get one and the same answer', async () => {
    const booted = await start();
    const { post, sent, runtime } = booted;
    const { id } = await sent();
    const wire = renderTypeId('eff', id);
    const unknown = renderTypeId('eff', '0198a2c4-7e10-7a3b-8c5d-3f2a1b9d4e99');
    const globex = runtime.tenants.globex;
    const answers = [
      await post('core.effectStatus', { id: wire }, { as: 'bob' }),
      await post('core.effectStatus', { id: wire }, { tenant: globex }),
      await post('core.effectStatus', { id: unknown }),
    ];
    const bodies = answers.map(({ json }) => {
      const { requestId: _requestId, ...rest } = (json as { error?: Record<string, unknown> })
        .error ?? { missing: true };
      return rest;
    });
    for (const answer of answers) expect(answer.status).toBe(404);
    expect(bodies[0]).toMatchObject({ kind: 'not_found' });
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    // The owner still reads it.
    expect((await post('core.effectStatus', { id: wire })).status).toBe(200);
  });

  test('an effect requested without a submitter is read by nobody', async () => {
    const booted = await start();
    const { post, runtime, scopeOf, acme } = booted;
    const id = '0198a2c4-7e10-7a3b-8c5d-3f2a1b9d4e77';
    const ownId = '0198a2c4-7e10-7a3b-8c5d-3f2a1b9d4e78';
    const seeded = (rowId: string, over: Record<string, unknown>) => ({
      id: rowId,
      attempts: 0,
      type: 'dispatch.ship',
      commandId: `c-${rowId}`,
      status: 'requested',
      performer: 'external',
      input: { parcel: 'p-seed' },
      eventIds: [],
      ...over,
    });
    await runtime.sealed.unit(runtime.namespace, scopeOf(acme), (unit) =>
      seedRows({
        unit,
        registry: dispatchApp.registry,
        behaviours: entityBehavioursOf(dispatchApp.modules),
        rows: {
          'core.effect': [
            seeded(id, {}),
            seeded(ownId, { principalResolver: 'test.principal', principalId: 'ada' }),
          ],
        },
        now: Temporal.Instant.from('2026-01-01T00:00:00Z'),
      }),
    );
    // The row without a submitter is stored, with a creation time and both submitter columns null.
    const stored = (await booted.rows('core.effect')).find((row) => row.id === id);
    expect(stored?.createdAt).toBeInstanceOf(Temporal.Instant);
    expect(stored?.principalResolver ?? null).toBeNull();
    expect(stored?.principalId ?? null).toBeNull();
    // The seeded row of ada is read by ada alone: the seed reached the scope and the view.
    const own = await post('core.effectStatus', { id: renderTypeId('eff', ownId) }, { as: 'ada' });
    expect(own.status).toBe(200);
    expect(resultOf(own)).toMatchObject({ id: renderTypeId('eff', ownId), status: 'requested' });
    expect(
      (await post('core.effectStatus', { id: renderTypeId('eff', ownId) }, { as: 'bob' })).status,
    ).toBe(404);
    for (const as of ['ada', 'bob']) {
      const answer = await post('core.effectStatus', { id: renderTypeId('eff', id) }, { as });
      expect(answer.status).toBe(404);
    }
  });

  test('an anonymous caller is refused', async () => {
    const booted = await start();
    const { runtime, sent } = booted;
    const { id } = await sent();
    const headers = {
      'x-tenant': booted.acme.id,
      [testPrincipalHeader]: JSON.stringify({ subject: null, roles: [], claims: {} }),
    };
    const ids = [renderTypeId('eff', id)];
    const query = await runtime.fetch(
      new Request(`${dispatchUrl}/_keelwerk/v1/invoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ action: 'core.effectStatus', input: { id: ids[0] } }),
      }),
    );
    expect(query.status).toBe(401);
    const watch = await runtime.fetch(
      new Request(
        `${dispatchUrl}/_keelwerk/v1/subscribe?action=core.effectStatusWatch&input=${encodeURIComponent(JSON.stringify({ ids }))}`,
        { headers },
      ),
    );
    // A subscription that is refused answers an event stream whose one event is the error.
    const text = await watch.text();
    expect(text).toContain('event: error');
    expect(text).toContain('"kind":"unauthenticated"');
    expect(text).not.toContain('event: data');
  });

  test('the wire bytes of the view hold only its members', async () => {
    const booted = await start();
    const { post, sent, call } = booted;
    const { id } = await sent({ deadline: dispatchSoon(booted) });
    const wire = renderTypeId('eff', id);
    const before = await post('core.effectStatus', { id: wire });
    await call('dispatch.report', { effectId: id, ok: true, tracking: 'T-secret-tracking' });
    const after = await post('core.effectStatus', { id: wire });
    for (const answer of [before, after]) {
      expect(Object.keys(resultOf(answer)).sort()).toEqual(expect.arrayContaining(statusKeys));
      for (const key of Object.keys(resultOf(answer))) {
        expect(['deadline', 'id', 'requestedAt', 'runAt', 'settledAt', 'status', 'type']).toContain(
          key,
        );
      }
      for (const secret of secrets) expect(answer.text).not.toContain(secret);
    }
  });

  test('core.effect.get still answers forbidden to the submitter', async () => {
    const booted = await start();
    const { post, sent } = booted;
    const { id } = await sent();
    const answer = await post('core.effect.get', { ids: [renderTypeId('eff', id)] });
    expect(answer.status).toBe(403);
  });
});
