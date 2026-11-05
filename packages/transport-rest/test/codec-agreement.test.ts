import {
  type Call,
  protocolCodec,
  startTransportRuntime,
  transportTargetOf,
} from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, test } from 'vitest';
import { restCodec } from './support/rest-codec.ts';
import { transportWithRest } from './support/transport-app.ts';

const running = await startTransportRuntime({ app: transportWithRest, host: httpHost() });
afterAll(() => running.stop());
const target = transportTargetOf(running, restCodec, []);

const dueAt = '2026-12-01T00:00:00Z';
const ada = { subject: 'agree-ada' };

async function idOf(call: Call): Promise<string> {
  const sent = await target.codec.send(target, call);
  const value = sent.decoded.ok ? (sent.decoded.value as { id?: string }) : {};
  if (value.id === undefined) throw new Error(`no id: ${JSON.stringify(sent.decoded)}`);
  return value.id;
}

function newBook(isbn: string): Call {
  return {
    action: 'library.book.create',
    input: { title: 'Agree', isbn, addedBy: ada.subject },
    caller: ada,
  };
}

// The two transports must decode the same outcome for the same call. Both run against one
// deployment, so every call below is made through REST and through the protocol on fresh rows
// and compared by what an application sees: ok or the error kind and code.
describe('REST and the invocation protocol decode one outcome', () => {
  const cases: readonly (readonly [string, () => Promise<readonly [Call, Call]>])[] = [
    ['a command that succeeds', async () => [lend('one'), lend('two')]],
    [
      'an anonymous command',
      async () => [
        { ...lend('x'), caller: {} },
        { ...lend('y'), caller: {} },
      ],
    ],
    ['an input that fails validation', async () => [invalid(), invalid()]],
    ['a query', async () => [query(), query()]],
    [
      'an unknown id',
      async () => [
        update('book_01h455vb4pex5vsknk084sn02q', {}),
        update('book_01h455vb4pex5vsknk084sn02q', {}),
      ],
    ],
    [
      'an update with a patch',
      async () => [
        update(await idOf(newBook('agree-1')), { title: 'A' }),
        update(await idOf(newBook('agree-2')), { title: 'A' }),
      ],
    ],
    [
      'an update with a TypeID in the patch',
      async () => {
        const other = await idOf(newBook('agree-3'));
        const first = await idOf(newBook('agree-4'));
        const second = await idOf(newBook('agree-5'));
        return [update(first, { relatedTo: other }), update(second, { relatedTo: other })];
      },
    ],
    [
      'a stale version',
      async () => [
        { ...update(await idOf(newBook('agree-6')), { title: 'B' }), ifVersion: 5 },
        { ...update(await idOf(newBook('agree-7')), { title: 'B' }), ifVersion: 5 },
      ],
    ],
    [
      'an archive',
      async () => [
        archive(await idOf(newBook('agree-8'))),
        archive(await idOf(newBook('agree-9'))),
      ],
    ],
  ];

  function lend(title: string): Call {
    return { action: 'loans.lend', input: { bookTitle: title, dueAt }, caller: ada };
  }
  function invalid(): Call {
    return { action: 'loans.lend', input: { bookTitle: 7, dueAt }, caller: ada };
  }
  function query(): Call {
    return { action: 'library.book.query', input: {}, caller: ada };
  }
  function update(id: string, patch: Record<string, unknown>): Call {
    return { action: 'library.book.update', input: { id, patch }, caller: ada };
  }
  function archive(id: string): Call {
    return { action: 'library.book.archive', input: { id }, caller: ada };
  }

  for (const [name, make] of cases) {
    test(name, async () => {
      const [forRest, forProtocol] = await make();
      const viaRest = await target.codec.send(target, forRest);
      const viaProtocol = await protocolCodec.send(target, forProtocol);
      expect(viaRest.decoded.ok).toBe(viaProtocol.decoded.ok);
      if (viaRest.decoded.ok && viaProtocol.decoded.ok) {
        expect(viaRest.decoded.accepted).toBe(viaProtocol.decoded.accepted);
      } else {
        expect(viaRest.decoded).toEqual(viaProtocol.decoded);
      }
    });
  }
});
