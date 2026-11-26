import { createRemoteClient } from '@keelwerk/client';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  bootInternalApp,
  headersOf,
  type InternalRuntime,
  ran,
  send,
  url,
} from './support/internal-command-kit.ts';
import { asOperator } from './support/targeting-kit.ts';

let runtime: InternalRuntime;
beforeAll(async () => {
  runtime = await bootInternalApp();
});
afterAll(() => runtime.stop());

const explain = (ref: string) =>
  asOperator(runtime, 'core.explain', {
    mode: 'decision',
    ref,
    tenant: runtime.tenants.acme?.id ?? '',
    as: 'user:ada',
    input: { n: 1 },
  });

describe('who still reaches an internal command', () => {
  test('explain finds it for an operator and says it is internal; an unknown reference answers as before', async () => {
    const found = await explain('probe.sweep');
    expect(found.ok).toBe(true);
    const decision = found.ok ? (found.value as { allowed: boolean; notes?: string[] }) : undefined;
    expect(decision?.allowed).toBe(true);
    expect(decision?.notes?.join(' ')).toContain('This command is internal');
    const twin = await explain('probe.sweepOpen');
    expect(twin.ok ? (twin.value as { notes?: string[] }).notes : undefined).toBeUndefined();
    const missing = await explain('probe.nothing');
    expect(missing.ok ? undefined : [missing.error.kind, missing.error.message]).toEqual([
      'not_implemented',
      '"probe.nothing" is not an action of this app.',
    ]);
  });

  test('an operator who invokes it directly gets the answer for an unknown action', async () => {
    const direct = await asOperator(runtime, 'probe.sweep', { n: 1 });
    expect(direct.ok ? undefined : direct.error.message).toBe(
      '"probe.sweep" is not an action of this app.',
    );
    expect(ran).toEqual([]);
  });

  test('the typed client refuses before it sends', async () => {
    const sent: string[] = [];
    const client = createRemoteClient<never>({
      url,
      apiVersion: JSON.parse((await send(runtime, '/_keelwerk/v1/surface', undefined, true)).body)
        .apiVersion,
      tenant: runtime.tenants.acme?.id ?? '',
      fetch: (async (input: Request | string | URL, init?: RequestInit) => {
        const request = new Request(input, {
          ...init,
          headers: { ...headersOf(runtime, true), ...init?.headers },
        });
        sent.push(new URL(request.url).pathname);
        return runtime.fetch(request);
      }) as typeof fetch,
    });
    const refused = await (client as { invoke(ref: string, input: unknown): Promise<unknown> })
      .invoke('probe.sweep', { n: 1 })
      .catch((error: unknown) => error as { code?: string });
    expect(refused).toMatchObject({ code: 'core.not_found' });
    expect(sent.filter((path) => path.endsWith('/invoke'))).toEqual([]);
    await (client as { invoke(ref: string, input: unknown): Promise<unknown> }).invoke(
      'probe.sweepOpen',
      { n: 3 },
    );
    expect(sent.filter((path) => path.endsWith('/invoke'))).toHaveLength(1);
  });

  test('another module runs it in its unit and as a job, under the gate, as before', async () => {
    ran.length = 0;
    const poked = await send(
      runtime,
      '/_keelwerk/v1/invoke',
      { action: 'other.poke', input: {} },
      true,
    );
    expect(poked.status).toBe(200);
    await runtime.drainJobs();
    expect([...ran].sort()).toEqual(['later:8', 'sweep:7']);
  });
});
