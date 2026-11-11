import type { WireError } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { sseCarrier } from '../../src/carriers/sse/sse-carrier.ts';
import { fakeConnection, options, type Sse, streamOf } from '../support/carrier-kit.ts';

describe('the sse carrier', () => {
  test('is named sse and refuses a connection of another kind', async () => {
    expect(sseCarrier.name).toBe('sse');
    const { stream } = streamOf([]);
    await expect(
      sseCarrier.serve(stream, { kind: 'websocket' } as never, options),
    ).rejects.toMatchObject({ kind: 'internal' });
  });

  test('opens with retry and welcome', async () => {
    const { connection, written } = fakeConnection();
    await sseCarrier.serve(streamOf([]).stream, connection, options);
    expect(written[0]).toBe(
      'retry: 3000\n\nevent: welcome\ndata: {"apiVersion":"2026-11-11","surfaceHash":"sha256-x","protocol":1}\n\n',
    );
  });

  test('an item carries its token as id', async () => {
    const { connection, written } = fakeConnection();
    await sseCarrier.serve(
      streamOf([{ event: { type: 'changed', id: 'x' }, state: 'v2.tok' as never }]).stream,
      connection,
      options,
    );
    expect(written[1]).toBe('id: v2.tok\nevent: data\ndata: {"type":"changed","id":"x"}\n\n');
  });

  test('head carries its state as id and a gap carries none', async () => {
    const { connection, written } = fakeConnection();
    await sseCarrier.serve(
      streamOf([
        { control: 'head', state: 'v2.a' as never },
        { control: 'gap', missed: 3 },
      ]).stream,
      connection,
      options,
    );
    expect(written.slice(1, 3)).toEqual([
      'id: v2.a\nevent: head\ndata: {"state":"v2.a"}\n\n',
      'event: gap\ndata: {"missed":3}\n\n',
    ]);
  });

  test('a reset overflow with a state is the last frame, carries its id and no end follows', async () => {
    const { connection, written, ends } = fakeConnection();
    const { stream, state } = streamOf([
      { control: 'reset', reason: 'overflow', state: 'v2.b' as never },
      { event: 'never written', state: 'v2.c' as never },
    ]);
    await sseCarrier.serve(stream, connection, options);
    expect(written.slice(1)).toEqual([
      'id: v2.b\nevent: reset\ndata: {"reason":"overflow","state":"v2.b"}\n\n',
    ]);
    expect(ends).toEqual([]);
    expect(state.returned).toBe(true);
  });

  test.each(['resync', 'expired'] as const)(
    'a reset %s carries no id line and no end follows',
    async (reason) => {
      const { connection, written, ends } = fakeConnection();
      await sseCarrier.serve(streamOf([{ control: 'reset', reason }]).stream, connection, options);
      expect(written.slice(1)).toEqual([`event: reset\ndata: {"reason":"${reason}"}\n\n`]);
      expect(written.join('')).not.toContain('id:');
      expect(ends).toEqual([]);
    },
  );

  test('a stateless overflow writes no id, so the client keeps the one it holds', async () => {
    const { connection, written } = fakeConnection();
    await sseCarrier.serve(
      streamOf([{ control: 'reset', reason: 'overflow' }]).stream,
      connection,
      options,
    );
    expect(written.slice(1)).toEqual(['event: reset\ndata: {"reason":"overflow"}\n\n']);
  });

  test('a frame that cannot be built ends the stream with an error frame of the closed projection', async () => {
    const { connection, failed, written } = fakeConnection();
    const seen: unknown[] = [];
    const closed: WireError = {
      kind: 'internal',
      code: 'core.internal',
      message: 'closed',
      retryable: false,
      requestId: 'r',
    };
    const { stream, state } = streamOf([{ event: 10n, state: 'v2.x' as never }]);
    await sseCarrier.serve(stream, connection, {
      ...options,
      wireError: (error) => {
        seen.push(error);
        return closed;
      },
    });
    expect(seen).toHaveLength(1);
    expect(failed).toEqual([closed]);
    expect(written.join('')).not.toContain('v2.x');
    expect(state.returned).toBe(true);
  });

  test('without wireError a frame that cannot be built is public and leaks nothing', async () => {
    const { connection, failed } = fakeConnection();
    await sseCarrier.serve(streamOf([{ event: 10n }]).stream, connection, options);
    expect(failed[0]).toMatchObject({ kind: 'internal', requestId: '' });
    expect(JSON.stringify(failed[0])).not.toContain('BigInt');
  });

  test('a stream error is written through wireError', async () => {
    const { connection, failed } = fakeConnection();
    const wire: WireError = {
      kind: 'forbidden',
      code: 'core.forbidden',
      message: 'No.',
      retryable: false,
      requestId: 'req-1',
    };
    await sseCarrier.serve(streamOf([], errors.forbidden('No.')).stream, connection, {
      ...options,
      wireError: () => wire,
    });
    expect(failed).toEqual([wire]);
  });

  test('without wireError an error is public with an empty request id', async () => {
    const { connection, failed } = fakeConnection();
    await sseCarrier.serve(streamOf([], new Error('secret detail')).stream, connection, options);
    expect(failed[0]).toMatchObject({ kind: 'internal', requestId: '' });
    expect(JSON.stringify(failed[0])).not.toContain('secret detail');
  });

  test('an aborted connection returns the stream', async () => {
    const { connection, abort } = fakeConnection();
    const { stream, state } = streamOf([], 'hang');
    const served = sseCarrier.serve(stream, connection, options);
    abort();
    await served;
    expect(state.returned).toBe(true);
  });

  test('an item larger than maxBufferedBytes ends with reset overflow, the last token and no end', async () => {
    const { connection, written, ends } = fakeConnection();
    const { stream, state } = streamOf([
      { event: { n: 1 }, state: 'v2.last' as never },
      { event: { text: 'x'.repeat(5000) }, state: 'v2.big' as never },
    ]);
    await sseCarrier.serve(stream, connection, { ...options, maxBufferedBytes: 1000 });
    expect(written.at(-1)).toBe(
      'id: v2.last\nevent: reset\ndata: {"reason":"overflow","state":"v2.last"}\n\n',
    );
    expect(written.join('')).not.toContain('xxxx');
    expect(ends).toEqual([]);
    expect(state.returned).toBe(true);
  });

  test('an oversized first item gives reset overflow without a state or an id', async () => {
    const { connection, written, ends } = fakeConnection();
    await sseCarrier.serve(
      streamOf([{ event: { text: 'x'.repeat(5000) }, state: 'v2.big' as never }]).stream,
      connection,
      { ...options, maxBufferedBytes: 1000 },
    );
    expect(written.slice(1)).toEqual(['event: reset\ndata: {"reason":"overflow"}\n\n']);
    expect(ends).toEqual([]);
  });

  test('a finished stream ends complete', async () => {
    const { connection, ends } = fakeConnection();
    await sseCarrier.serve(streamOf([{ event: 1 }]).stream, connection, options);
    expect(ends).toEqual(['complete']);
  });

  test('a write the connection refuses returns the stream', async () => {
    const { connection } = fakeConnection();
    const refused: Sse = {
      ...connection,
      write: async () => {
        throw errors.unavailable('closed');
      },
    };
    const { stream, state } = streamOf([{ event: 1 }]);
    await sseCarrier.serve(stream, refused, options);
    expect(state.returned).toBe(true);
  });
});
