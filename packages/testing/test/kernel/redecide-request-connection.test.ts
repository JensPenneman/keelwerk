import { describe, expect, test } from 'vitest';
import { runDirect } from './support/command-kit.ts';
import { command, effectsKit, registryWith } from './support/effects-kit.ts';
import { redecideDirect } from './support/redecide-kit.ts';

interface WriteContext {
  readonly request: {
    readonly connection?: { readonly remote: { readonly address: string } };
    readonly userAgent?: string;
  };
  readonly write: {
    readonly library: { readonly book: { create(values: Record<string, unknown>): unknown } };
  };
  newId(entity: string): Generator<never, string, unknown>;
}

/** A command whose title branches on the address; with `agent` it reads the user agent instead. */
function booted(reads: 'connection' | 'agent' | 'nothing') {
  const registry = registryWith({
    actions: [
      command('where', function* (_input: unknown, ctx: WriteContext) {
        const id = yield* ctx.newId('library.book');
        const title =
          reads === 'connection'
            ? ctx.request.connection?.remote.address === '10.0.0.1'
              ? 'inside'
              : 'outside'
            : reads === 'agent'
              ? (ctx.request.userAgent ?? 'none')
              : 'none';
        return [ctx.write.library.book.create({ id, title, isbn: 'i-1', addedBy: 'ada' })];
      } as never),
    ],
  });
  return { registry, adapter: effectsKit(registry).adapter, ref: 'library.where' };
}

const connection = {
  id: 'conn-1',
  listener: 'http',
  remote: { address: '10.0.0.1', port: 5000 },
  local: { address: '10.0.0.2', port: 443 },
} as const;
const request = { transport: 'rest', requestId: 'req-1', connection } as const;
const given =
  'the decision read the connection (the address), which a record never keeps; the re-decide was given none';

describe('the connection a decision read (7.9.6)', () => {
  test('a decision that read the address keeps the fact and not the address, and reproduces only when a re-decide is given one', async () => {
    const { registry, adapter, ref } = booted('connection');
    await runDirect({ registry, adapter, action: ref, input: {}, commandId: 'c-conn-1', request });
    const without = await redecideDirect({ registry, adapter, commandId: 'c-conn-1', input: {} });
    expect(without.reproduced).toBe(false);
    expect(JSON.stringify(without.recorded.decision)).not.toContain('10.0.0.1');
    const withIt = await redecideDirect({
      registry,
      adapter,
      commandId: 'c-conn-1',
      input: {},
      request: { connection },
    });
    expect(withIt.differences).toEqual([]);
    expect(withIt.reproduced).toBe(true);
  });
});

const nowReads =
  "the decision now reads request member 'connection', which the record did not keep";
const noLonger = "the decision no longer reads request member 'connection'";
const predates =
  ' (a record without a request member was written before request recording, or by a decision that read none)';

/**
 * R: the record kept `connection`; G: the re-decide was given a connection; B: the build reads it.
 * `recordedReads` is what the recorded decision read: 'nothing' leaves the record no request member.
 */
const rows: readonly {
  readonly row: string;
  readonly recordedReads: 'connection' | 'agent' | 'nothing';
  readonly buildReads: 'connection' | 'agent';
  readonly given: boolean;
  readonly lines: readonly string[];
}[] = [
  { row: 'R, G, B', recordedReads: 'connection', buildReads: 'connection', given: true, lines: [] },
  {
    row: 'R, not G, B',
    recordedReads: 'connection',
    buildReads: 'connection',
    given: false,
    lines: [given],
  },
  {
    row: 'R, not G, not B',
    recordedReads: 'connection',
    buildReads: 'agent',
    given: false,
    lines: [given],
  },
  {
    row: 'R, G, not B',
    recordedReads: 'connection',
    buildReads: 'agent',
    given: true,
    lines: [noLonger],
  },
  {
    row: 'not R, G, B',
    recordedReads: 'agent',
    buildReads: 'connection',
    given: true,
    lines: [nowReads],
  },
  {
    row: 'not R, G, B, no request member',
    recordedReads: 'nothing',
    buildReads: 'connection',
    given: true,
    lines: [`${nowReads}${predates}`],
  },
  {
    row: 'not R, not G, B',
    recordedReads: 'agent',
    buildReads: 'connection',
    given: false,
    lines: [],
  },
  {
    row: 'not R, not G, not B',
    recordedReads: 'agent',
    buildReads: 'agent',
    given: false,
    lines: [],
  },
  { row: 'not R, G, not B', recordedReads: 'agent', buildReads: 'agent', given: true, lines: [] },
];

describe('the lines about the connection of a re-decide (7.9.6)', () => {
  test.each(rows)('$row', async ({ recordedReads, buildReads, given: gave, lines }) => {
    const recorded = booted(recordedReads);
    const commandId = `c-table-${recordedReads}-${buildReads}-${String(gave)}`;
    await runDirect({
      registry: recorded.registry,
      adapter: recorded.adapter,
      action: recorded.ref,
      input: {},
      commandId,
      request: { ...request, userAgent: 'curl/8.7.1' },
    });
    const asked = booted(buildReads);
    const result = await redecideDirect({
      registry: asked.registry,
      adapter: recorded.adapter,
      commandId,
      input: {},
      ...(gave ? { request: { connection } } : {}),
    });
    expect(
      result.differences.filter(
        (line) => line.includes("'connection'") || line.includes('the connection'),
      ),
    ).toEqual(lines);
  });
});
