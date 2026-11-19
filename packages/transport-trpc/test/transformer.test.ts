import type { FieldNode } from '@keelwerk/core';
import SuperJson from 'superjson';
import { describe, expect, test } from 'vitest';
import { keelwerkSuperjson } from '../src/transformer/keelwerk-superjson.ts';
import { superjsonValueOf } from '../src/transformer/superjson-value-of.ts';
import { superjsonWireOf } from '../src/transformer/superjson-wire-of.ts';
import {
  mountedTrpc,
  mutateTrpc,
  queryTrpc,
  readTrpcAnswer,
  sendTrpc,
  trpcConformanceSurface,
  trpcPublicId,
  trpcSurfaceWith,
  trpcUuidOf,
} from './support/trpc-kit.ts';

const base = { optional: false, access: 'read-write' } as const;
const node = (kind: string, extra: Record<string, unknown> = {}): FieldNode =>
  ({ ...base, kind, ...extra }) as FieldNode;

const rich = node('shape', {
  fields: {
    at: node('instant'),
    day: node('date'),
    bytes: node('binary'),
    big: node('integer', { wide: true }),
    tags: node('set', { item: node('string') }),
    note: node('string'),
  },
});
const richWire = {
  at: '2026-11-19T10:00:00.000Z',
  day: '2026-11-19',
  bytes: 'AQID',
  big: '9007199254740993',
  tags: ['a', 'b'],
  note: 'x',
};

describe('the transformer', () => {
  test('superjson carries instants, dates, bytes, wide integers and sets both ways', () => {
    const values = superjsonValueOf(rich, richWire);
    expect(values).toEqual({
      at: Temporal.Instant.from('2026-11-19T10:00:00Z'),
      day: Temporal.PlainDate.from('2026-11-19'),
      bytes: new Uint8Array([1, 2, 3]),
      big: 9007199254740993n,
      tags: new Set(['a', 'b']),
      note: 'x',
    });
    const transformer = keelwerkSuperjson();
    const across = transformer.parse<Record<string, unknown>>(
      transformer.stringify(values as never),
    );
    expect(across.at).toBeInstanceOf(Temporal.Instant);
    expect(across.day).toBeInstanceOf(Temporal.PlainDate);
    expect(across.bytes).toBeInstanceOf(Uint8Array);
    expect(across.big).toBe(9007199254740993n);
    expect(across.tags).toEqual(new Set(['a', 'b']));
    expect(superjsonWireOf(rich, across)).toEqual(richWire);
  });

  test('a value that is not the wire form passes unchanged', () => {
    expect(superjsonValueOf(rich, { at: 'tomorrow', big: 'x', extra: 1 })).toEqual({
      at: 'tomorrow',
      big: 'x',
      extra: 1,
    });
    expect(superjsonWireOf(rich, 'not an object')).toBe('not an object');
  });

  test('ids stay public ids and hidden members stay out', async () => {
    const mounted = await mountedTrpc(trpcConformanceSurface(), (inv) =>
      inv.action === 'library.findByIsbn'
        ? { ok: true, value: { bookId: trpcUuidOf(7), title: 'Dune', secret: 'hidden' } }
        : { ok: true, value: { module: 'loans', secret: 'hidden' } },
    );
    const found = await queryTrpc(mounted.handler, 'library.findByIsbn', { isbn: 'x' });
    expect(found.body.result.data.json).toEqual({ bookId: trpcPublicId('book', 7), title: 'Dune' });
    const about = await queryTrpc(mounted.handler, 'loans.about', {});
    expect(about.body.result.data.json).toEqual({ module: 'loans' });
  });

  test('a command input revives to the values the core decodes', async () => {
    const mounted = await mountedTrpc(trpcConformanceSurface(), () => ({
      ok: true,
      value: { loanId: trpcUuidOf(1) },
    }));
    const dueAt = Temporal.Instant.from('2026-12-01T00:00:00Z');
    const answer = await mutateTrpc(mounted.handler, 'loans.lend', { bookTitle: 'Dune', dueAt });
    expect(answer.status).toBe(200);
    expect(mounted.calls[0]?.input).toEqual({ bookTitle: 'Dune', dueAt });
  });

  test('bytes that are no unpadded base64url are refused as validation, never stored empty', async () => {
    const surface = trpcSurfaceWith(
      trpcConformanceSurface(),
      { input: node('shape', { fields: { bytes: node('binary') } }) },
      'loans.lend',
    );
    const mounted = await mountedTrpc(surface, () => ({
      ok: true,
      value: { loanId: trpcUuidOf(1) },
    }));
    const send = async (bytes: string) =>
      readTrpcAnswer(
        await sendTrpc(mounted.handler, 'loans.lend', {
          method: 'POST',
          rawBody: JSON.stringify({
            json: { bytes },
            meta: { values: { bytes: [['custom', 'Uint8Array']] } },
          }),
        }),
      );
    const padded = await send('AQID+/==');
    expect(padded.status).toBe(400);
    expect(padded.body.error.json.data.keelwerk).toMatchObject({ kind: 'validation' });
    expect(mounted.calls).toEqual([]);
    expect((await send('AQID')).status).toBe(200);
    expect(mounted.calls[0]?.input).toEqual({ bytes: new Uint8Array([1, 2, 3]) });
  });

  test('an output with instants, bytes and wide integers is revived for the client', async () => {
    const surface = trpcSurfaceWith(trpcConformanceSurface(), { output: rich }, 'loans.about');
    const mounted = await mountedTrpc(surface, () => ({
      ok: true,
      value: {
        at: Temporal.Instant.from('2026-11-19T10:00:00Z'),
        day: Temporal.PlainDate.from('2026-11-19'),
        bytes: new Uint8Array([1, 2, 3]),
        big: 9007199254740993n,
        tags: new Set(['a', 'b']),
        note: 'x',
      },
    }));
    const answer = await queryTrpc(mounted.handler, 'loans.about', {});
    const seen = keelwerkSuperjson().deserialize<Record<string, unknown>>(answer.body.result.data);
    expect(seen.at).toEqual(Temporal.Instant.from('2026-11-19T10:00:00Z'));
    expect(seen.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(seen.big).toBe(9007199254740993n);
    expect(seen.tags).toEqual(new Set(['a', 'b']));
  });

  test('transformer json answers the plain wire', async () => {
    const surface = trpcSurfaceWith(trpcConformanceSurface(), { output: rich }, 'loans.about');
    const mounted = await mountedTrpc(
      surface,
      () => ({
        ok: true,
        value: {
          at: Temporal.Instant.from('2026-11-19T10:00:00Z'),
          day: Temporal.PlainDate.from('2026-11-19'),
          bytes: new Uint8Array([1, 2, 3]),
          big: 9007199254740993n,
          tags: new Set(['a', 'b']),
          note: 'x',
        },
      }),
      { options: { transformer: 'json' } },
    );
    const response = await sendTrpc(mounted.handler, 'loans.about', { search: 'input=%7B%7D' });
    expect(((await response.json()) as { result: { data: unknown } }).result.data).toEqual(
      richWire,
    );
  });

  test('keelwerkSuperjson leaves the global instance untouched', () => {
    keelwerkSuperjson();
    const global = SuperJson.serialize(Temporal.Instant.from('2026-11-19T10:00:00Z'));
    expect(JSON.stringify(global.meta ?? {})).not.toContain('Temporal');
    expect(keelwerkSuperjson()).not.toBe(keelwerkSuperjson());
  });
});
