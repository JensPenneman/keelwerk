import type { AppType } from '@keelwerk/core';
import { defineApp } from '@keelwerk/core';
import { live } from '@keelwerk/live';
import { startTestRuntime } from '@keelwerk/testing';
import { hooks } from '@keelwerk/testing/fixtures';
import { httpHost } from '@keelwerk/transport-http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRemoteClient } from '../../src/index.ts';
import { fastRetry, principalHeaders, withHeaders } from './support/live-fixtures.ts';
import { type PostRecorder, startPostRecorder } from './support/post-recorder.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const appDef = defineApp({ id: 'hooks-live', modules: [live, hooks] });
interface HooksLiveApp extends AppType<typeof appDef> {}

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

async function boot(answer?: (index: number) => number | 'hang') {
  const endpoint: PostRecorder = await startPostRecorder(answer);
  const runtime = await startTestRuntime(appDef, {
    tenants: ['acme'],
    adapter: 'memory',
    config: { hooks: { endpoint: endpoint.url, signingKey: 'hook-signing-key' } },
    workers: { queues: ['posts', 'commands'], egress: { allow: ['127.0.0.0/8'] } },
    host: httpHost(),
  });
  cleanup.push(
    () => runtime.stop(),
    () => endpoint.close(),
  );
  const sent: string[] = [];
  const client = createRemoteClient<HooksLiveApp>({
    url: 'https://hooks.example.test',
    apiVersion: runtime.head,
    fetch: withHeaders(
      (request) => {
        sent.push(new URL(request.url).pathname);
        return runtime.fetch(request);
      },
      { ...principalHeaders('ada'), 'x-tenant': runtime.tenants.acme.id },
    ),
    retry: fastRetry,
  });
  return { endpoint, runtime, client, sent };
}

describe('waitForEffects against a running deployment', () => {
  it('answers the settled status of the effect a command requested', async () => {
    const { client } = await boot();
    const answer = await client.attempt('hooks.notify', { payload: '{"hello":"world"}' });
    if (!answer.ok) throw answer.error;
    expect(answer.effects).toHaveLength(1);
    const statuses = await client.waitForEffects(answer.effects ?? [], { timeoutMs: 30_000 });
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ type: 'hooks.post', status: 'succeeded' });
    expect(statuses[0]?.settledAt).toBeInstanceOf(Temporal.Instant);
    expect(statuses[0]?.id).toBe(answer.effects?.[0]);
  });

  it('invoke with waitEffects resolves once the effect settled', async () => {
    const { client, endpoint } = await boot();
    await client.invoke('hooks.notify', { payload: 'x' }, { waitEffects: { timeoutMs: 30_000 } });
    expect(endpoint.requests).toHaveLength(1);
  });

  it('rejects an id the caller never requested with core.not_found', async () => {
    const { client } = await boot();
    await expect(client.waitForEffects([crypto.randomUUID()])).rejects.toMatchObject({
      kind: 'not_found',
      code: 'core.not_found',
    });
  });

  it('resolves at the timeout with the status as it stands when the endpoint never answers', async () => {
    const { client } = await boot(() => 'hang');
    const answer = await client.attempt('hooks.notify', { payload: 'slow' });
    if (!answer.ok) throw answer.error;
    const statuses = await client.waitForEffects(answer.effects ?? [], { timeoutMs: 500 });
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.status).toBe('requested');
  });

  it('sends nothing for no ids', async () => {
    const { client, sent } = await boot();
    const before = sent.length;
    await expect(client.waitForEffects([])).resolves.toEqual([]);
    expect(sent).toHaveLength(before);
  });
});
