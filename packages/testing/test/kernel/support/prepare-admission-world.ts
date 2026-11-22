import { type Clock, errors, type QuotaLimits } from '@keelwerk/core';
import { bookEntity, loanEntity } from './command-kit.ts';
import {
  command,
  effectEntity,
  effectsKit,
  externalEffect,
  reaction,
  receiptEntity,
  registryWith,
} from './effects-kit.ts';
import { type InlinePrepareContext, pingDraft } from './inline-kit.ts';
import { tokensTaken, withRequestRates } from './rate-quota-kit.ts';
import { namespace, open, tenant } from './run-read-kit.ts';

// The admission of a command with `prepare` against the storage counters, on the in-memory adapter
// with limits the test sets. What decides each case: the committed store and the executor's count
// after the awaited calls, and a clock that only the test or the `prepare` of the case moves.

const start = Temporal.Instant.from('2026-03-01T00:00:00Z');
const huge = Number.MAX_SAFE_INTEGER;

interface World {
  now: Temporal.Instant;
  runs: number;
  bytes: number;
  rows: number;
  /** How many effects the `prepare` performs: the second one only after the receipt has expired. */
  performs: number;
  /** Whether the decision of `probe` refuses, after its `prepare` has performed its effect. */
  refuse: boolean;
  /** The queued cap of the commands lane, the same for every scope. */
  queued: number;
  /** Runs inside the inline executor, after it counted its run: a case holds or cuts the attempt there. */
  onRun?: (() => void | Promise<void>) | undefined;
}

/** The limits the write path reads: the test's numbers, the same for every scope. */
function limitsOf(world: World, rates?: Readonly<Record<string, number>>): QuotaLimits {
  return {
    limitOf: withRequestRates(
      (_registry, _scope, ref) =>
        ref === 'core.rows'
          ? { kind: 'count', value: world.rows }
          : { kind: 'bytes', value: world.bytes },
      rates,
    ),
    queueOf: () => ({ running: 4, queued: world.queued, weight: 1 }),
    fresh: async () => undefined,
  };
}

interface GrowContext {
  readonly write: {
    readonly library: { readonly book: { create(values: Record<string, unknown>): unknown } };
  };
}

/** A `prepare` step that performs the inline effect `ping` and answers its outcome. */
function* performsPing(_input: unknown, ctx: InlinePrepareContext) {
  return yield* ctx.perform(pingDraft);
}

/** The decision of a command that stores nothing itself and invokes `target` with its input. */
const relaysTo = (target: string) => (input: { isbn: string; title?: string }) => ({
  events: [],
  effects: [
    {
      kind: 'invoke',
      type: 'invoke',
      action: target,
      input: { isbn: input.isbn, ...(input.title === undefined ? {} : { title: input.title }) },
    },
  ],
});

/**
 * An inline reaction of the outer command: a book titled `Relayed` makes it invoke `library.grow`
 * (a synchronous command) for a book of its own.
 */
const relayer = reaction('library.relayer', 'library.book.created', ((event: {
  state: { title: string };
}) =>
  event.state.title === 'Relayed'
    ? {
        events: [],
        effects: [
          { kind: 'invoke', type: 'invoke', action: 'library.grow', input: { isbn: 'rl-1' } },
        ],
      }
    : []) as never);

/** An inline reaction: a book titled `Echoed` is followed by a second book, in the same unit. */
const echo = reaction('library.echo', 'library.book.created', ((
  event: { state: { title: string } },
  ctx: GrowContext,
) =>
  event.state.title === 'Echoed'
    ? [ctx.write.library.book.create({ title: 'Echo', isbn: 'echo-1', addedBy: 'ada' })]
    : []) as never);

/**
 * A tenant with `library.grow` (a command without `prepare` that stores a book, so the counters
 * move) and `library.probe` (a command with `prepare` that performs the inline effect `ping`).
 */
export function boot(
  options: {
    readonly echo?: boolean;
    readonly relay?: boolean;
    /** The capacities of the request rates by ref (15 where none is named); default: rates no case reaches. */
    readonly rates?: Readonly<Record<string, number>>;
  } = {},
) {
  const world: World = {
    now: start,
    runs: 0,
    bytes: huge,
    rows: huge,
    performs: 1,
    refuse: false,
    queued: huge,
  };
  const clock: Clock = { now: () => world.now };
  const ping = externalEffect(
    'ping',
    async () => {
      world.runs += 1;
      await world.onRun?.();
      return { ok: true };
    },
    // An hour, so that no timer of the executor decides a case that holds it.
    { inline: true, timeout: '1h' },
  );
  const registry = registryWith({
    effects: [ping.effect],
    executors: [ping.executor],
    actions: [
      // An asynchronous command: its accept leaves a receipt that is `accepted`, not finished.
      command('slow', (() => []) as never, { execution: 'async' }),
      command('grow', ((input: { isbn: string; title?: string }, ctx: GrowContext) => [
        ctx.write.library.book.create({
          title: input.title ?? 'Grown',
          isbn: input.isbn,
          addedBy: 'ada',
        }),
      ]) as never),
      // A command with `prepare` whose decision stores nothing itself and invokes `library.grow`, a
      // synchronous command of its own unit (the same decision without `prepare`: `relayPlain`).
      command('relay', relaysTo('library.grow') as never, { prepare: performsPing as never }),
      // The same decision without `prepare`; invoked by `relayDeep` it nests `library.grow` two deep.
      command('relayPlain', relaysTo('library.grow') as never),
      // A command with `prepare` whose decision invokes `library.relayPlain` (a command without
      // `prepare`), which invokes `library.grow`: the unit of `relayDeep` holds a command two deep.
      command('relayDeep', relaysTo('library.relayPlain') as never, {
        prepare: performsPing as never,
      }),
      // A command whose policy no rule grants: the authorization refuses it.
      command('guarded', (() => []) as never, { auth: 'policy' }),
      // A command with `prepare` whose decision enqueues the job of `library.slow`, which carries
      // the queued cap of the scope.
      command(
        'queueing',
        (() => ({
          events: [],
          effects: [{ kind: 'invoke', type: 'invoke', action: 'library.slow', input: {} }],
        })) as never,
        { prepare: performsPing as never },
      ),
      command(
        'probe',
        (() => {
          if (world.refuse) throw errors.validation('The decision refuses.');
          return [];
        }) as never,
        {
          prepare: function* (_input: unknown, ctx: InlinePrepareContext) {
            const first = yield* ctx.perform(pingDraft);
            if (world.performs > 1) {
              // The receipt of the command expires while `prepare` runs.
              world.now = world.now.add({ hours: 48 });
              yield* ctx.perform({ ...pingDraft, input: { to: 'bea@example.org' } });
            }
            return first;
          } as never,
        },
      ),
      // A command with `prepare` whose decision stores a book, and, for the title `Echoed`, whose
      // inline reaction stores a second one in the same unit.
      command(
        'stock',
        ((input: { title: string; isbn: string }, ctx: GrowContext) => [
          ctx.write.library.book.create({ title: input.title, isbn: input.isbn, addedBy: 'ada' }),
        ]) as never,
        {
          prepare: performsPing as never,
        },
      ),
      // A `prepare` that performs nothing: no effect row ties a later run of its id to the window of the first.
      command('bare', (() => []) as never, {
        // biome-ignore lint/correctness/useYield: a `prepare` with nothing to perform
        prepare: function* () {
          return null;
        } as never,
      }),
    ],
    // An inline reaction declares the limits of its unit unless the unit is exempt from the tail
    // (`isExemptFromTail`); only the cases about reactions register one (`echo`, `relay`), so that
    // taking out the reactions' exemption fails those cases alone.
    reactions: [
      ...(options.echo === true ? [echo] : []),
      ...(options.relay === true ? [relayer] : []),
    ],
  });
  const counted = tokensTaken(open([bookEntity, loanEntity, effectEntity, receiptEntity], clock));
  const { adapter, invoke } = effectsKit(registry, {
    adapter: counted.adapter,
    clock,
    quotas: limitsOf(world, options.rates),
  });
  /** Both counters of the tenant, read in one unit. */
  const read = () =>
    adapter.unit(
      namespace,
      tenant,
      async (unit): Promise<readonly [bigint, bigint]> => [
        await unit.usage.get('core.eventBytes'),
        await unit.usage.get('core.rows'),
      ],
    );
  return {
    world,
    adapter,
    invoke,
    read,
    registry,
    unlimited: huge,
    taken: counted.taken,
    away: counted.away,
  };
}
