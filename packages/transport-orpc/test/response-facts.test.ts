import {
  type ApiSurface,
  deriveEffectId,
  deriveSurface,
  type Invoker,
  type SurfaceAction,
} from '@keelwerk/core';
import { startTransportRuntime } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, test } from 'vitest';
import { invokeProcedure } from '../src/router/invoke-procedure.ts';
import type { OrpcAnswer } from '../src/router/orpc-answer.ts';
import { subscribeProcedure } from '../src/router/subscribe-procedure.ts';
import { orpcConformanceApp, orpcConformanceVersions } from './support/orpc-conformance-app.ts';
import { orpcEchoApp } from './support/orpc-echo-app.ts';
import { performedEffects } from './support/performed-effects.ts';

const runtime = await startTransportRuntime({
  app: orpcEchoApp(),
  host: httpHost(),
  config: { orpc: { cors: [] } },
  workers: true,
});
afterAll(() => runtime.stop());

/** A raw RPC call of a command as a signed-in user. */
function post(path: string, input: unknown, extra: Record<string, string> = {}): Promise<Response> {
  const principal = { subject: 'ada-facts', roles: [], claims: {} };
  return runtime.fetch(
    new Request(`https://${runtime.domains.acme}/orpc/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-principal': JSON.stringify(principal),
        ...extra,
      },
      body: JSON.stringify({ json: input }),
    }),
  );
}

describe('the response facts of a command', () => {
  test('prefer respond-async answers 202, names the preference and echoes the command id', async () => {
    const key = crypto.randomUUID();
    const response = await post(
      'loans/lend',
      { bookTitle: 'Ulysses', dueAt: '2026-12-01T00:00:00Z' },
      { prefer: 'respond-async', 'idempotency-key': key },
    );
    expect(response.status).toBe(202);
    expect(response.headers.get('preference-applied')).toBe('respond-async');
    expect(response.headers.get('keelwerk-command-id')).toBe(key);
  });

  test('an async command without Prefer answers 202 and names no preference', async () => {
    const response = await post('echo/settle', {});
    expect(response.status).toBe(202);
    expect(response.headers.get('preference-applied')).toBeNull();
    expect(response.headers.get('keelwerk-command-id')).not.toBeNull();
  });

  test('a command with deferred effects lists the ids of the effects it planned, in order', async () => {
    const key = crypto.randomUUID();
    const response = await post('echo/notify', {}, { 'idempotency-key': key });
    expect(response.status).toBe(200);
    const header = response.headers.get('keelwerk-effects');
    expect(header).not.toBeNull();
    await runtime.drainJobs();
    const ran = performedEffects.filter(
      (effect) => effect.id === deriveEffectId(effect.scope, key, 0),
    );
    expect(ran).toHaveLength(1);
    const scope = ran[0]?.scope;
    if (scope === undefined) throw new Error('The effect did not run.');
    expect(header).toBe([0, 1].map((index) => deriveEffectId(scope, key, index)).join(','));
    expect(performedEffects.some((effect) => effect.id === deriveEffectId(scope, key, 1))).toBe(
      true,
    );
  });

  test('a failed command names no command id', async () => {
    const lend = { bookTitle: 'Dubliners', dueAt: '2026-12-01T00:00:00Z' };
    expect((await post('loans/lend', lend)).status).toBe(200);
    const key = crypto.randomUUID();
    const failed = await post('loans/lend', lend, { 'idempotency-key': key });
    expect(failed.status).toBe(409);
    expect(failed.headers.get('keelwerk-command-id')).toBeNull();
  });
});

describe('what a failed call leaves out', () => {
  const surface: ApiSurface = deriveSurface(
    orpcConformanceApp as never,
    orpcConformanceVersions.head,
  ).surface;
  const found = surface.actions.find((candidate) => candidate.ref === 'loans.lend');
  if (found === undefined) throw new Error('The surface has no loans.lend.');
  const deprecated = { reason: 'Use another.', at: '2026-11-05', sunset: '2099-12-31' };
  const lend: SurfaceAction = { ...found, deprecated };

  function contextOf(invoker: unknown, answer: OrpcAnswer): never {
    return {
      session: { principal: { kind: 'user' } },
      carrier: { transport: 'http', headers: { 'idempotency-key': crypto.randomUUID() } },
      requestId: 'r1',
      signal: new AbortController().signal,
      invoker,
      surface,
      wire: 'json',
      development: false,
      log: { error: () => undefined },
      setCookies: [],
      answer,
    } as never;
  }

  const input = { bookTitle: 'Ulysses', dueAt: '2026-12-01T00:00:00.000Z' };

  test('a command whose output does not fit sets no answer field', async () => {
    const answer: OrpcAnswer = {};
    const context = contextOf(
      {
        invoke: async (invocation: { commandId?: string }) => ({
          ok: true,
          replayed: true,
          value: { not: 'the output of loans.lend', id: invocation.commandId },
          effects: ['effect-1'],
        }),
      } as unknown as Invoker,
      answer,
    );
    await expect(invokeProcedure(context, lend, input)).rejects.toBeDefined();
    expect(answer.commandId).toBeUndefined();
    expect(answer.deprecated).toBeUndefined();
    expect(answer.replayed).toBeUndefined();
    expect(answer.effects).toBeUndefined();
  });

  test('a failed command sets neither the command id nor the deprecation', async () => {
    const answer: OrpcAnswer = {};
    const invoker = {
      invoke: async () => ({ ok: false, error: new Error('refused') }),
    } as unknown as Invoker;
    await expect(invokeProcedure(contextOf(invoker, answer), lend, input)).rejects.toBeDefined();
    expect(answer.commandId).toBeUndefined();
    expect(answer.deprecated).toBeUndefined();
  });

  test('a command that succeeded sets both', async () => {
    const answer: OrpcAnswer = {};
    const invoker = {
      invoke: async (invocation: { commandId?: string }) => ({
        ok: true,
        receipt: { commandId: invocation.commandId, status: 'accepted' },
      }),
    } as unknown as Invoker;
    await invokeProcedure(contextOf(invoker, answer), lend, input);
    expect(answer.commandId).toBeDefined();
    expect(answer.deprecated).toEqual(deprecated);
  });

  test('a subscription that opened sets the deprecation', async () => {
    const watch = surface.actions.find((candidate) => candidate.ref === 'loans.loanEvents');
    if (watch === undefined) throw new Error('The surface has no loans.loanEvents.');
    const answer: OrpcAnswer = {};
    const invoker = {
      subscribe: () => ({
        [Symbol.asyncIterator]: () => ({
          next: async () => ({ done: false, value: { control: 'head', state: 'v2.1' } }),
          return: async () => ({ done: true, value: undefined }),
        }),
      }),
    } as unknown as Invoker;
    const iterator = await subscribeProcedure(
      contextOf(invoker, answer),
      { ...watch, deprecated },
      {},
      undefined,
      undefined,
    );
    expect(answer.deprecated).toEqual(deprecated);
    await iterator.return?.();
  });

  test('a subscription that is refused sets no deprecation', async () => {
    const watch = surface.actions.find((candidate) => candidate.ref === 'loans.loanEvents');
    if (watch === undefined) throw new Error('The surface has no loans.loanEvents.');
    const answer: OrpcAnswer = {};
    const invoker = {
      subscribe: () => ({
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            throw new Error('refused');
          },
        }),
      }),
    } as unknown as Invoker;
    await expect(
      subscribeProcedure(
        contextOf(invoker, answer),
        { ...watch, deprecated },
        {},
        undefined,
        undefined,
      ),
    ).rejects.toBeDefined();
    expect(answer.deprecated).toBeUndefined();
  });
});
