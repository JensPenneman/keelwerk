import { describe, expect, test } from 'vitest';
import type { EventMeta } from '../events/event-meta.ts';
import { processStateStream } from '../reactions/process-state-stream.ts';
import { eventMetaText } from './event-meta-text.ts';
import { storedEventBytes } from './stored-event-bytes.ts';
import { storedStreamRecordBytes } from './stored-stream-record-bytes.ts';

const bytes = (value: unknown): bigint => BigInt(Buffer.byteLength(JSON.stringify(value)));
const meta = {
  actor: { kind: 'system', id: null, via: 'core.test' },
  commandId: 'c-1',
  action: 'a.b',
  causationId: null,
  correlationId: 'r-1',
  client: null,
  merge: null,
  traceparent: null,
  writer: { build: 'b', revision: 1 },
  flags: [],
  decision: null,
} satisfies EventMeta;
const metaBytes = BigInt(Buffer.byteLength(eventMetaText(meta)));

describe('what a stored record costs', () => {
  test('an event costs its data, its before image and its meta', () => {
    expect(storedEventBytes('shop.order', { data: { a: 'é' }, before: { a: 0 }, meta })).toBe(
      bytes({ a: 'é' }) + bytes({ a: 0 }) + metaBytes,
    );
    expect(storedEventBytes('shop.order', { data: undefined, before: null, meta })).toBe(
      bytes(null) + metaBytes,
    );
  });

  test('the meta carries its decision record in the form the store keeps', () => {
    const decision = {
      part: 'a.b',
      inputDigest: 'd',
      reads: [{ at: 7n }],
      answers: [],
      effects: [],
      request: undefined,
    } as unknown as EventMeta['decision'];
    expect(eventMetaText({ ...meta, decision })).toContain('"at":"7"');
  });

  test('the change records of receipts cost nothing, every other transient record does', () => {
    const event = { data: { a: 1 }, before: null, meta };
    expect(storedEventBytes('core.commandReceipt', event)).toBe(0n);
    expect(storedEventBytes('shop.cart', event)).toBe(bytes({ a: 1 }) + metaBytes);
  });

  test('stream records cost their JSON text, the process state cache nothing', () => {
    expect(storedStreamRecordBytes('shop.audit', [{ n: 1 }, 'x'])).toBe(
      bytes({ n: 1 }) + bytes('x'),
    );
    expect(storedStreamRecordBytes(processStateStream, [{ n: 1 }])).toBe(0n);
  });
});
