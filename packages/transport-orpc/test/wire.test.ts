import { startTransportRuntime } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, test } from 'vitest';
import { nativeOfWire } from '../src/wire/native-of-wire.ts';
import { orpcJsonSerializers } from '../src/wire/orpc-json-serializers.ts';
import { wireOfNative } from '../src/wire/wire-of-native.ts';
import { orpcEchoApp } from './support/orpc-echo-app.ts';

const wire = {
  at: '2026-11-12T10:00:00.000Z',
  on: '2026-11-12',
  big: '9007199254740993',
  bytes: 'AQID',
  tags: ['a', 'b'],
  label: 'plain',
};

const memory = await startTransportRuntime({
  app: orpcEchoApp(),
  host: httpHost(),
  config: { orpc: { cors: [] } },
});
const plain = await startTransportRuntime({
  app: orpcEchoApp({ serializer: 'json' }),
  host: httpHost(),
  config: { orpc: { cors: [] } },
});
afterAll(async () => {
  await memory.stop();
  await plain.stop();
});

function call(runtime: typeof memory, path: string, body: unknown): Promise<Response> {
  return runtime.fetch(
    new Request(`https://${runtime.domains.acme}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

describe('over the host', () => {
  test('the default serialiser marks instants, dates, wide integers, bytes and sets in meta', async () => {
    const answer = await call(memory, '/orpc/echo/mirror', { json: wire, meta: [] });
    expect(answer.status).toBe(200);
    const body = (await answer.json()) as { json: unknown; meta: unknown[] };
    expect(body.json).toEqual(wire);
    expect(body.meta).toEqual(
      expect.arrayContaining([
        [20, 'at'],
        [21, 'on'],
        [0, 'big'],
        [22, 'bytes'],
        [6, 'tags'],
      ]),
    );
  });

  test('serializer json answers plain JSON with an empty meta', async () => {
    const answer = await call(plain, '/orpc/echo/mirror', { json: wire, meta: [] });
    expect(answer.status).toBe(200);
    // oRPC leaves `meta` out when nothing needs a mark.
    expect(await answer.json()).toEqual({ json: wire });
  });

  test('an input sent with oRPC types decodes like its wire form', async () => {
    const typed = await call(memory, '/orpc/echo/mirror', {
      json: wire,
      meta: [
        [20, 'at'],
        [21, 'on'],
        [0, 'big'],
        [22, 'bytes'],
        [6, 'tags'],
      ],
    });
    const plainForm = await call(memory, '/orpc/echo/mirror', { json: wire, meta: [] });
    expect(typed.status).toBe(200);
    expect(await typed.json()).toEqual(await plainForm.json());
  });

  test('an input whose instant is no instant is a validation error, not an internal one', async () => {
    const answer = await call(memory, '/orpc/echo/mirror', { json: { ...wire, at: 'nope' } });
    expect(answer.status).toBe(422);
  });

  test('a value only oRPC revives is core.malformed_request with its path, on both serialisers', async () => {
    const sent: readonly (readonly [string, unknown, number])[] = [
      ['a Map', [['k', 1]], 7],
      ['a Date', '2026-11-12T10:00:00.000Z', 1],
      ['a number that is not finite', null, 2],
    ];
    for (const runtime of [memory, plain]) {
      for (const [kind, json, type] of sent) {
        const answer = await call(runtime, '/orpc/echo/mirror', {
          json: { ...wire, label: json },
          meta: [[type, 'label']],
        });
        expect(answer.status, kind).toBe(400);
        const body = (await answer.json()) as { json: { data: Record<string, unknown> } };
        expect(body.json.data, kind).toMatchObject({
          kind: 'validation',
          code: 'core.malformed_request',
          issues: [{ path: ['label'], message: expect.stringContaining(kind) }],
        });
      }
    }
  });
});

describe('wireOfNative', () => {
  test('writes the in-process kinds as their wire strings and walks objects, arrays and sets', () => {
    const native = {
      at: Temporal.Instant.from('2026-11-12T10:00:00Z'),
      on: Temporal.PlainDate.from('2026-11-12'),
      big: 9007199254740993n,
      bytes: new Uint8Array([1, 2, 3]),
      tags: new Set(['a', 'b']),
      nested: [{ at: Temporal.Instant.from('2026-11-12T10:00:00Z') }],
      plain: 1,
    };
    expect(wireOfNative(native)).toEqual({
      at: '2026-11-12T10:00:00.000Z',
      on: '2026-11-12',
      big: '9007199254740993',
      bytes: 'AQID',
      tags: ['a', 'b'],
      nested: [{ at: '2026-11-12T10:00:00.000Z' }],
      plain: 1,
    });
  });

  test('refuses what only oRPC revives, with an issue at its path', () => {
    const refusal = (value: unknown): unknown => {
      try {
        wireOfNative(value);
      } catch (thrown) {
        return thrown;
      }
      return undefined;
    };
    const cases: readonly (readonly [unknown, string])[] = [
      [new Date(0), 'a Date'],
      [new Map([['k', 1]]), 'a Map'],
      [new URL('https://example.test/'), 'a URL'],
      [/x/u, 'a RegExp'],
      [new Blob(['x']), 'a Blob or File'],
      [new File(['x'], 'x.txt'), 'a Blob or File'],
      [Number.NaN, 'a number that is not finite'],
      [Number.POSITIVE_INFINITY, 'a number that is not finite'],
    ];
    for (const [value, kind] of cases) {
      expect(refusal({ payload: { deep: [0, value] } }), kind).toMatchObject({
        kind: 'validation',
        code: 'core.malformed_request',
        issues: [{ path: ['payload', 'deep', 1], message: expect.stringContaining(kind) }],
      });
    }
  });

  test('drops an undefined member and turns an undefined item into null, as JSON writes them', () => {
    expect(wireOfNative({ a: undefined, b: [undefined, 1], c: new Set([undefined]) })).toEqual({
      b: [null, 1],
      c: [null],
    });
    expect(Object.hasOwn(wireOfNative({ a: undefined }) as object, 'a')).toBe(false);
  });

  test('keeps an instant the wire cannot write as text, so the decode refuses it', () => {
    const far = Temporal.Instant.from('+010000-01-01T00:00:00Z');
    expect(typeof wireOfNative(far)).toBe('string');
  });
});

describe('nativeOfWire', () => {
  const node = {
    kind: 'shape',
    fields: {
      at: { kind: 'instant' },
      big: { kind: 'integer', wide: true },
      small: { kind: 'integer', wide: false },
      tags: { kind: 'set', item: { kind: 'string' } },
      bytes: { kind: 'binary' },
      owner: { kind: 'ref', target: 'loans.loan', prefix: 'loan' },
      rows: { kind: 'page', item: { kind: 'shape', fields: { on: { kind: 'date' } } } },
    },
  } as never;

  test('gives the carried kinds their in-process types and keeps ids and the masked member', () => {
    const result = nativeOfWire(node, {
      at: '2026-11-12T10:00:00.000Z',
      big: '42',
      small: 7,
      tags: ['a'],
      bytes: 'AQID',
      owner: 'loan_01h455vb4pex5vsknk084sn02q',
      rows: { items: [{ on: '2026-11-12' }] },
      $masked: ['secret'],
    }) as Record<string, unknown>;
    expect(result.at).toBeInstanceOf(Temporal.Instant);
    expect(result.big).toBe(42n);
    expect(result.small).toBe(7);
    expect(result.tags).toEqual(new Set(['a']));
    expect(result.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.owner).toBe('loan_01h455vb4pex5vsknk084sn02q');
    expect(result.$masked).toEqual(['secret']);
    const rows = result.rows as { items: { on: unknown }[] };
    expect(rows.items[0]?.on).toBeInstanceOf(Temporal.PlainDate);
  });

  test('leaves a value that does not decode as it is', () => {
    expect(nativeOfWire({ kind: 'instant' } as never, 'not an instant')).toBe('not an instant');
    expect(nativeOfWire({ kind: 'instant' } as never, 12)).toBe(12);
  });
});

describe('orpcJsonSerializers', () => {
  test('revives its three types from strings', () => {
    const [instant, date, bytes] = orpcJsonSerializers;
    expect(instant?.type).toBe(20);
    expect(date?.type).toBe(21);
    expect(bytes?.type).toBe(22);
    expect(instant?.deserialize('2026-11-12T10:00:00.000Z')).toBeInstanceOf(Temporal.Instant);
    expect(date?.deserialize('2026-11-12')).toBeInstanceOf(Temporal.PlainDate);
    expect(bytes?.deserialize('AQID')).toEqual(new Uint8Array([1, 2, 3]));
  });

  test('refuses a value that is not a string or does not decode', () => {
    for (const serializer of orpcJsonSerializers) {
      expect(() => serializer.deserialize(5)).toThrow(TypeError);
    }
    expect(() => orpcJsonSerializers[0]?.deserialize('tomorrow')).toThrow(TypeError);
  });
});
