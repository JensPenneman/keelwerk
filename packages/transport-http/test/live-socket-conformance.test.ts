import { kernelCommandId, type LiveServerMessage } from '@keelwerk/core';
import { freshName, lendCall, sendCall } from '@keelwerk/testing';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { connectKitSocket } from './support/connect-kit-socket.ts';
import { type StreamRuntime, startStreamRuntime } from './support/stream-runtime.ts';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const tokenShape = /^v2\.[0-9a-z.]+$/;
const kits: StreamRuntime[] = [];
afterAll(async () => {
  await Promise.all(kits.map((kit) => kit.runtime.stop()));
});

async function boot(pglite: boolean): Promise<StreamRuntime> {
  const kit = await startStreamRuntime({ listen: { port: 0 } }, { pglite });
  kits.push(kit);
  return kit;
}

const memory = await boot(false);
const pg = await boot(true);

const loanOf = (message: LiveServerMessage): string =>
  (message as { item: { loanId: string } }).item.loanId;

describe.each([
  ['the in-memory adapter', memory],
  ['PGlite', pg],
] as const)('keelwerk.live.v1 on %s', (_name, kit) => {
  test('hello opens the session and welcome names the principal, the API version, the surface hash and protocol 1', async () => {
    const client = await connectKitSocket(kit, freshName('ada'));
    try {
      const welcome = await client.next();
      expect(welcome).toMatchObject({
        type: 'welcome',
        principal: { kind: 'user' },
        heartbeatMs: 30_000,
        protocol: 1,
      });
      const body = welcome as Extract<LiveServerMessage, { type: 'welcome' }>;
      expect(body.surfaceHash).toMatch(/^sha256-/);
      expect(body.apiVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    } finally {
      await client.close();
    }
  });

  test('a subscription streams head, then the loans that change, as data messages with id and state', async () => {
    const ada = freshName('ada');
    const client = await connectKitSocket(kit, ada);
    try {
      await client.next();
      client.send({ type: 'subscribe', id: 'loans', action: 'loans.loanEvents', input: {} });
      const head = await client.next();
      expect(head).toMatchObject({ type: 'head', id: 'loans' });
      expect((head as { state: string }).state).toMatch(tokenShape);
      await sendCall(kit.target, lendCall(ada, freshName('Dune')));
      const item = await client.next();
      expect(item).toMatchObject({ type: 'data', id: 'loans', item: { kind: 'created' } });
      expect((item as { state: string }).state).toMatch(tokenShape);
      expect(loanOf(item)).toMatch(/^loan_[0-9a-z]{26}$/);
    } finally {
      await client.close();
    }
  });

  test('three subscriptions on one socket resume each from its own token after a reconnect', async () => {
    const ada = freshName('ada');
    const lend = () => sendCall(kit.target, lendCall(ada, freshName('Book')));
    const first = await connectKitSocket(kit, ada);
    const tokens: Record<string, string> = {};
    try {
      await first.next();
      for (const id of ['a', 'b', 'c']) {
        first.send({ type: 'subscribe', id, action: 'loans.loanEvents', input: {} });
        const frames = await first.until((m) => m.type === 'head' && m.id === id);
        tokens[id] = (frames.at(-1) as { state: string }).state;
        // One more loan before the next subscription starts: each token names a later position.
        await lend();
        await first.until((m) => m.type === 'data' && m.id === id);
      }
    } finally {
      await first.close();
    }
    await lend();
    const second = await connectKitSocket(kit, ada);
    try {
      await second.next();
      for (const id of ['a', 'b', 'c']) {
        second.send({
          type: 'subscribe',
          id,
          action: 'loans.loanEvents',
          input: {},
          after: tokens[id],
        });
      }
      const heads = new Set<string>();
      const loans: Record<string, string[]> = { a: [], b: [], c: [] };
      await second.until((message) => {
        if (message.type === 'data') loans[message.id]?.push(loanOf(message));
        if (message.type === 'head') heads.add(message.id);
        return heads.size === 3;
      });
      // `a` missed the loans of three positions, `b` of two, `c` of one: each resumed from its own token.
      const [a, b, c] = [loans.a ?? [], loans.b ?? [], loans.c ?? []];
      expect(a).toHaveLength(b.length + 1);
      expect(b).toHaveLength(c.length + 1);
      expect(c.length).toBeGreaterThanOrEqual(1);
      expect(new Set(a).size).toBe(a.length);
    } finally {
      await second.close();
    }
  });

  test('a v1 token and another principal’s token answer reset resync as the last message; a malformed after is an error under its id and the socket stays open', async () => {
    const ada = freshName('ada');
    const owner = await connectKitSocket(kit, ada);
    let current = '';
    try {
      await owner.next();
      owner.send({ type: 'subscribe', id: 'x', action: 'loans.loanEvents', input: {} });
      const frames = await owner.until((m) => m.type === 'head');
      current = (frames.at(-1) as { state: string }).state;
    } finally {
      await owner.close();
    }
    const [, epoch, position, scope, check] = current.split('.');
    const old = `v1.${epoch}.${position}.${scope}.${check?.slice(0, 8)}`;
    const client = await connectKitSocket(kit, freshName('bob'));
    try {
      await client.next();
      client.send({
        type: 'subscribe',
        id: 'old',
        action: 'loans.loanEvents',
        input: {},
        after: old,
      });
      const resync = await client.until((m) => m.type === 'reset' || m.type === 'error');
      expect(resync.at(-1)).toMatchObject({ type: 'reset', id: 'old', reason: 'resync' });
      client.send({
        type: 'subscribe',
        id: 'foreign',
        action: 'loans.loanEvents',
        input: {},
        after: current,
      });
      const foreign = await client.until((m) => m.type === 'reset' || m.type === 'error');
      expect(foreign.at(-1)).toMatchObject({ type: 'reset', id: 'foreign', reason: 'resync' });
      client.send({
        type: 'subscribe',
        id: 'bad',
        action: 'loans.loanEvents',
        input: {},
        after: 'NOT A TOKEN!',
      });
      const bad = await client.until((m) => m.type === 'error');
      expect(bad.at(-1)).toMatchObject({
        type: 'error',
        id: 'bad',
        error: { code: 'core.malformed_request' },
      });
      expect(JSON.stringify(bad)).not.toContain('NOT A TOKEN');
      client.send({ type: 'ping' });
      expect((await client.until((m) => m.type === 'pong')).at(-1)).toEqual({ type: 'pong' });
    } finally {
      await client.close();
    }
  });

  test('invoke answers what POST /invoke answers; a kernel-form command id is core.command_id_reserved; a bad commandId is malformed', async () => {
    const ada = freshName('ada');
    const client = await connectKitSocket(kit, ada);
    try {
      await client.next();
      const call = {
        action: 'loans.lend',
        input: { bookTitle: freshName('Emma'), dueAt: '2026-12-01T00:00:00Z' },
      };
      client.send({
        type: 'invoke',
        id: 'i1',
        request: { action: call.action, input: call.input, commandId: freshName('cmd') },
      });
      const result = await client.until((m) => m.type === 'result' && m.id === 'i1');
      const over = (await sendCall(kit.target, lendCall(ada, freshName('Hamlet')))).decoded;
      expect(over.ok).toBe(true);
      const answer = (result.at(-1) as { response: { ok: boolean; value: unknown } }).response;
      expect(answer.ok).toBe(true);
      expect(Object.keys(answer.value as object).sort()).toEqual(
        Object.keys((over as { value: object }).value).sort(),
      );
      const unknown = (
        await kit.target.codec.send(kit.target, {
          action: 'loans.nothing',
          caller: { subject: ada },
        })
      ).decoded;
      client.send({ type: 'invoke', id: 'i2', request: { action: 'loans.nothing' } });
      const missing = await client.until((m) => m.type === 'result' && m.id === 'i2');
      expect(missing.at(-1)).toMatchObject({
        response: { ok: false, error: { code: unknown.ok ? '' : unknown.code } },
      });
      client.send({
        type: 'invoke',
        id: 'i3',
        request: {
          action: call.action,
          input: call.input,
          commandId: kernelCommandId('reaction', 'relay.echo', 'e1'),
        },
      });
      const reserved = await client.until((m) => m.type === 'result' && m.id === 'i3');
      expect(reserved.at(-1)).toMatchObject({
        response: { ok: false, error: { code: 'core.command_id_reserved' } },
      });
      client.send({
        type: 'invoke',
        id: 'i4',
        request: { action: call.action, input: call.input, commandId: 'has a space' },
      });
      const bad = await client.until((m) => m.type === 'result' && m.id === 'i4');
      expect(bad.at(-1)).toMatchObject({
        response: { ok: false, error: { code: 'core.malformed_request' } },
      });
    } finally {
      await client.close();
    }
  });

  test('unsubscribe ends that subscription with end complete and leaves the others', async () => {
    const ada = freshName('ada');
    const client = await connectKitSocket(kit, ada);
    try {
      await client.next();
      for (const id of ['one', 'two']) {
        client.send({ type: 'subscribe', id, action: 'loans.loanEvents', input: {} });
        await client.until((m) => m.type === 'head' && m.id === id);
      }
      client.send({ type: 'unsubscribe', id: 'one' });
      const ended = await client.until((m) => m.type === 'end');
      expect(ended.at(-1)).toEqual({ type: 'end', id: 'one', reason: 'complete' });
      await sendCall(kit.target, lendCall(ada, freshName('Ulysses')));
      const next = await client.next();
      expect(next).toMatchObject({ type: 'data', id: 'two' });
    } finally {
      await client.close();
    }
  });
});
