import {
  type AnyField,
  defineApp,
  defineCommand,
  defineEffect,
  defineEffectExecutor,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineProcess,
  defineRule,
  defineStream,
  errors,
  field,
  outcomeOf,
  shape,
} from '@keelwerk/core';
import type { Site } from './marked-grid.ts';

type Members = Readonly<Record<string, AnyField>>;

/** What the commands, the process and the executor of the skeleton write: set by the driver before it invokes. */
const feed: { values: Readonly<Record<string, unknown>>; continued: number } = {
  values: {},
  continued: 0,
};

/** How a site marks a member personal: a command input names the subject member of its own input. */
function personalAt(site: Site): (member: AnyField, options?: object) => AnyField {
  return (member, options = {}) =>
    member.personal(site === 'commandInput' ? { ...options, subject: 'owner' } : options) as never;
}

/** How a site marks a member personal under another subject than its own. */
const otherAt =
  (_site: Site) =>
  (member: AnyField): AnyField =>
    member.personal({ subject: 'other' }) as never;

type Ctx = {
  newId: (entity: unknown) => Generator<unknown, string>;
  write: {
    mp: { holder: { create: (v: object) => unknown }; log: { append: (...a: never[]) => unknown } };
  };
  events: Record<string, (v: object) => unknown>;
};

/**
 * One app for one site: the shape of the site holds `members`, every other shape is plain. The
 * skeleton has an entity (its fields, its `noted` event), a stream keyed by it, a process on the
 * event, a sealed effect with its executor, and commands that write them from `feed.values`; the
 * members of a site that is a shape of a command or the configuration stand in that shape.
 */
function skeletonModule(site: Site, members: Members) {
  const own = (at: Site): Members => (site === at ? members : {});
  const holder = defineEntity({
    prefix: 'hld',
    dataSubject: 'id',
    fields: { name: field.string({ maxLength: 50 }), ...own('entity') },
    events: { noted: shape(own('domainEvent')) },
    evolve: { noted: (state: object) => state },
  } as never);
  const log = defineStream({
    key: field.ref.own('holder'),
    record: shape({ n: field.integer(), ...own('streamRecord') }),
    readAs: 'holder',
  } as never);
  const base = defineModuleBase({
    id: 'mp',
    version: '0.1.0',
    entities: { holder },
    streams: { log },
    ...(site === 'configuration' ? { config: shape(members) } : {}),
  } as never);
  const ping = defineEffect(
    base as never,
    {
      input: shape({ owner: field.subject(), ...own('effectInput') }),
      output: shape(site === 'effectOutput' ? members : { ok: field.boolean() }),
      dataSubject: 'owner',
    } as never,
  );
  const pingExecutor = defineEffectExecutor(
    base as never,
    ping as never,
    {
      queue: 'pings',
      run: () => Promise.resolve(site === 'effectOutput' ? feed.values : { ok: true }),
    } as never,
  );
  const operator = { principal: 'operator' };
  const enrol = defineCommand(
    base as never,
    {
      input: shape({}),
      output: shape({ id: field.ref.own('holder') }),
      ...operator,
      *decide(_input: unknown, ctx: never) {
        const c = ctx as Ctx;
        const id = yield* c.newId(holder);
        return {
          events: [
            c.write.mp.holder.create({
              id,
              name: 'ada',
              ...(site === 'entity' ? feed.values : {}),
            }),
            c.write.mp.log.append(
              id as never,
              [{ n: 1, ...(site === 'streamRecord' ? feed.values : {}) }] as never,
            ),
          ],
          result: { id },
        };
      },
    } as never,
  );
  const note = defineCommand(
    base as never,
    holder as never,
    {
      input: shape({}),
      decide: (_i: unknown, _current: unknown, ctx: never) => [
        (ctx as Ctx).events.noted?.(site === 'domainEvent' ? feed.values : {}),
      ],
    } as never,
  );
  // The continuation of `ping`: it receives the effect's outcome once the executor has settled it.
  const after = defineCommand(
    base as never,
    {
      input: outcomeOf(ping as never, shape(own('outcomeInput'))),
      principal: 'service',
      decide: () => {
        feed.continued += 1;
        return {};
      },
    } as never,
  );
  const ask = defineCommand(
    base as never,
    {
      input: shape({ owner: field.subject() }),
      ...operator,
      decide: (input: { owner: string }) => ({
        effects: [
          (ping as never as (v: object, o?: object) => unknown)(
            {
              owner: input.owner,
              ...(site === 'effectInput' ? feed.values : {}),
            },
            { continueWith: after, with: {} },
          ),
        ],
      }),
    } as never,
  );
  const jobInput = shape({ owner: field.subject(), ...own('commandInput') });
  // A job that fails for a reason a retry may mend stays queued (the clock of the run is pinned, so the retry never falls due).
  const run = defineCommand(
    base as never,
    {
      execution: 'async',
      input: jobInput,
      ...operator,
      decide: () => {
        throw errors.unavailable('Not reachable yet.');
      },
    } as never,
  );
  const lookup = defineEffect(
    base as never,
    {
      input: shape({ owner: field.subject(), ...own('effectInput') }),
      output: shape({ ok: field.boolean() }),
      dataSubject: 'owner',
    } as never,
  );
  const lookupExecutor = defineEffectExecutor(
    base as never,
    lookup as never,
    { queue: 'lookups', inline: true, run: () => Promise.resolve({ ok: true }) } as never,
  );
  // Performs the effect inline: a dry run stops there and shows its input.
  const check = defineCommand(
    base as never,
    {
      input: shape({ owner: field.subject() }),
      ...operator,
      prepare: (input: { owner: string }, ctx: never) =>
        (ctx as { perform: (draft: unknown) => unknown }).perform(
          (lookup as never as (v: object) => unknown)({
            owner: input.owner,
            ...(site === 'effectInput' ? feed.values : {}),
          }),
        ),
      decide: () => ({}),
    } as never,
  );
  const out = defineCommand(
    base as never,
    {
      input: shape({}),
      output: shape(site === 'commandOutput' ? members : {}),
      ...operator,
      // It writes a row, so that its decision has events and a re-decide has something to answer.
      *decide(_input: unknown, ctx: never) {
        const c = ctx as Ctx;
        const id = yield* c.newId(holder);
        return {
          events: [c.write.mp.holder.create({ id, name: 'out' })],
          result: site === 'commandOutput' ? feed.values : {},
        };
      },
    } as never,
  );
  const watch = defineProcess(
    base as never,
    {
      on: ['mp.holder.noted'],
      key: (event: { stream: { id: string } }) => event.stream.id,
      dataSubject: 'instanceKey',
      events: { seen: shape({ n: field.integer(), ...own('processEvent') }) },
      initial: { n: 0 },
      evolve: (state: { n: number }) => ({ n: state.n + 1 }),
      react: (_event: unknown, _state: unknown, ctx: never) => [
        (ctx as Ctx).events.seen?.({ n: 1, ...(site === 'processEvent' ? feed.values : {}) }),
      ],
    } as never,
  );
  const allow = (action: object) =>
    defineRule(base as never, action as never, { effect: 'allow', principal: 'operator' } as never);
  const mod = defineModule(
    base as never,
    {
      actions: { enrol, run, out, ask, after, check },
      entityActions: { holder: { note } },
      effects: { ping, lookup },
      executors: { ping: pingExecutor, lookup: lookupExecutor },
      reactions: { watch },
      policies: {
        enrol: { o: allow(enrol) },
        run: { o: allow(run) },
        check: { o: allow(check) },
        out: { o: allow(out) },
        ask: { o: allow(ask) },
        after: {
          o: defineRule(
            base as never,
            after as never,
            {
              effect: 'allow',
              principal: 'service',
            } as never,
          ),
        },
        holder: {
          o: defineRule(
            base as never,
            holder as never,
            {
              effect: 'allow',
              actions: ['read', 'write', 'note'],
              principal: 'operator',
              reason: 'probe',
            } as never,
          ),
        },
      },
    } as never,
  );
  return mod;
}

const skeletonApp = (site: Site, members: Members) =>
  defineApp({ id: 'mp-app', modules: [skeletonModule(site, members)] as never });

export { feed, otherAt, personalAt, skeletonApp, skeletonModule };
