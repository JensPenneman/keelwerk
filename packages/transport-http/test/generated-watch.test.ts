import { freshName, lendCall } from '@keelwerk/testing';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { connectKitSocket } from './support/connect-kit-socket.ts';
import { startStreamRuntime } from './support/stream-runtime.ts';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const kit = await startStreamRuntime({ listen: { port: 0 } });
afterAll(() => kit.runtime.stop());

const watch = { action: 'loans.loan.watch', input: {} };

describe('the generated watch over the wire carriers', () => {
  test('loans.loan.watch encodes over SSE: head, then a created item with row and version', async () => {
    const subject = freshName('ada');
    const stream = await kit.target.codec.subscribe?.(kit.target, {
      ...watch,
      caller: { subject },
    });
    if (stream === undefined) throw new Error('no stream');
    try {
      expect(stream.response.status).toBe(200);
      const frames = await stream.until((frame) => frame.event === 'head');
      expect(frames.map((frame) => frame.event)).toEqual(['welcome', 'head']);
      await kit.target.codec.send(kit.target, lendCall(subject, freshName('Dune')));
      const item = await stream.next();
      expect(item?.event).toBe('data');
      expect(item?.data).toMatchObject({
        type: 'created',
        id: expect.stringMatching(/^loan_/),
        version: 1,
        row: { borrower: subject, bookTitle: expect.stringMatching(/^Dune/), state: 'open' },
      });
    } finally {
      await stream.close();
    }
  });

  test('the same item over keelwerk.live.v1', async () => {
    const subject = freshName('ada');
    const client = await connectKitSocket(kit, subject);
    try {
      expect(await client.next()).toMatchObject({ type: 'welcome' });
      client.send({ type: 'subscribe', id: 'w', ...watch });
      await client.until((message) => message.type === 'head');
      await kit.target.codec.send(kit.target, lendCall(subject, freshName('Emma')));
      const seen = await client.until((message) => message.type === 'data');
      expect((seen.at(-1) as { item: unknown }).item).toMatchObject({
        type: 'created',
        id: expect.stringMatching(/^loan_/),
        version: 1,
        row: { borrower: subject, bookTitle: expect.stringMatching(/^Emma/), state: 'open' },
      });
    } finally {
      await client.close();
    }
  });

  test('a masked note arrives as $masked over SSE and over the socket', async () => {
    const ada = freshName('ada');
    const auditor = freshName('auditor');
    const title = freshName('Hamlet');
    const caller = { subject: auditor, roles: ['auditor'] };
    const stream = await kit.target.codec.subscribe?.(kit.target, { ...watch, caller });
    const socket = await connectKitSocket(kit, auditor, {}, caller.roles);
    if (stream === undefined) throw new Error('no stream');
    try {
      expect(await socket.next()).toMatchObject({ type: 'welcome' });
      socket.send({ type: 'subscribe', id: 'm', ...watch });
      await socket.until((message) => message.type === 'head');
      await stream.until((frame) => frame.event === 'head');
      const lend = lendCall(ada, title);
      await kit.target.codec.send(kit.target, {
        ...lend,
        input: { ...lend.input, note: 'for the borrower only' },
      });
      const frames = await stream.until(
        (frame) =>
          frame.event === 'data' &&
          (frame.data as { row?: { bookTitle?: string } }).row?.bookTitle === title,
      );
      const messages = await socket.until(
        (message) =>
          message.type === 'data' &&
          (message as { item: { row?: { bookTitle?: string } } }).item.row?.bookTitle === title,
      );
      const items = [frames.at(-1)?.data, (messages.at(-1) as { item: unknown }).item];
      for (const item of items) {
        expect(item).toMatchObject({ type: 'created', row: { borrower: ada, $masked: ['note'] } });
        expect((item as { row: object }).row).not.toHaveProperty('note');
      }
    } finally {
      await socket.close();
      await stream.close();
    }
  });
});
