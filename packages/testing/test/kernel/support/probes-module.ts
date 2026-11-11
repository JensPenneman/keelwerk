import {
  defineCommand,
  defineEffect,
  defineEffectExecutor,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  type EntityType,
  errors,
  field,
  KeelwerkError,
  type ModuleType,
  outcomeOf,
  shape,
} from '@keelwerk/core';

const targetDef = defineEntity({
  prefix: 'prt',
  dataSubject: 'owner',
  fields: {
    owner: field.subject(),
    result: field.text().optional(),
    /** A secret the module keeps on its own row, and hands to an effect as the reference it loaded. */
    token: field.secret().optional(),
  },
  events: { recorded: shape({ result: field.text() }) },
  evolve: { recorded: (state, event) => ({ ...state, result: event.result }) },
});

interface Target extends EntityType<typeof targetDef> {}
const target: Target = targetDef;

const probesBase = defineModuleBase({
  id: 'probes',
  version: '0.1.0',
  entities: { target },
});

/**
 * One effect for every failure case of the executor tests: `mode` picks what the executor does,
 * `note` is a personal value sealed under `owner`, `group` names the lane group and `url` is where
 * the `fetch` mode goes.
 */
const act = defineEffect(probesBase, {
  dataSubject: 'owner',
  input: shape({
    owner: field.subject(),
    mode: field.string(),
    url: field.string(),
    group: field.string(),
    note: field.string().personal(),
  }),
  output: shape({ status: field.integer().optional(), text: field.text().optional() }),
});

/** Reveals a secret reference its module loaded from one of its own rows. */
const unseal = defineEffect(probesBase, {
  input: shape({ token: field.secret() }),
  output: shape({ text: field.text() }),
});

const hang = (signal: AbortSignal): Promise<never> =>
  new Promise((_resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        reject(signal.reason);
      },
      { once: true },
    );
  });

const actExecutor = defineEffectExecutor(probesBase, act, {
  queue: 'probes',
  // The `hang` mode outruns this deadline: the job's signal aborts with core.timeout.
  timeout: '5s',
  // The lane depends on `group` only; `peek` reads the personal member to prove the refusal at enqueue.
  group: ({ input }) => ({
    id: input.mode === 'peek' ? String(input.note) : `g:${input.group}`,
    concurrency: 1,
  }),
  capability: ({ input }) => (input.mode === 'smtp' ? ['smtp-out'] : []),
  run: async (input, ctx) => {
    switch (input.mode) {
      case 'validation':
        throw errors.validation(`The address ${input.note} is not valid.`);
      case 'unavailable':
        throw errors.unavailable(`Cannot reach ${input.note}.`);
      case 'rate_limited':
        // The first attempt is told to wait; the retry goes through.
        if (ctx.effect.attempt === 1) throw errors.rate_limited('Slow down.', { retryAfter: 120 });
        return { status: 200 };
      case 'nan':
        // The first attempt is told to wait for a time no clock can add (a Retry-After parsed from a date).
        if (ctx.effect.attempt === 1) {
          throw errors.rate_limited('Slow down.', { retryAfter: Number.NaN });
        }
        return { status: 200 };
      case 'badshape':
        // The destination acted, and the answer does not fit the output shape.
        return { status: '200' } as never;
      case 'leak':
        // A code of the right form that repeats the personal note: free text in a code.
        throw new KeelwerkError({
          kind: 'validation',
          code: `probes.rejected_${String(input.note)}`,
          message: `The address ${input.note} is not valid.`,
        });
      case 'quote':
        throw new Error(`delivery to ${input.note} failed`);
      case 'big':
        return { text: 'x'.repeat(70_000) };
      case 'blobs': {
        const verdict = (work: Promise<unknown>): Promise<string> =>
          work.then(
            () => 'resolved',
            (error: unknown) => (error as { code?: string }).code ?? 'unknown',
          );
        const read = await verdict(ctx.blobs.read('blob-1' as never));
        const write = await verdict(ctx.blobs.write(new Uint8Array(), 'text/plain'));
        return { text: `${read} ${write}` };
      }
      case 'fetch': {
        const answer = await ctx.egress.fetch(input.url);
        return { status: answer.status, text: await answer.text() };
      }
      case 'hang':
        return hang(ctx.signal);
      case 'attempt':
        return { status: ctx.effect.attempt, text: ctx.effect.id };
      default:
        return { status: 200 };
    }
  },
});

const unsealExecutor = defineEffectExecutor(probesBase, unseal, {
  queue: 'probes',
  run: async (input, ctx) => ({
    text: await ctx.secrets.reveal(input.token, 'a test reveals what its module loaded'),
  }),
});

const plant = defineCommand(probesBase, {
  input: shape({ owner: field.subject() }),
  output: shape({ targetId: field.ref.own('target') }),
  principal: 'user',
  *decide(input, ctx) {
    const id = yield* ctx.newId(target);
    return {
      events: [
        ctx.write.probes.target.create({ id, owner: input.owner, token: 'row-token-1' as never }),
      ],
      result: { targetId: id },
    };
  },
});

const sign = defineCommand(probesBase, target, {
  decide: (_input, current) => ({ effects: [unseal({ token: current.token as never })] }),
});

const run = defineCommand(probesBase, {
  input: shape({
    owner: field.subject(),
    mode: field.string(),
    url: field.string(),
    group: field.string(),
    note: field.string(),
  }),
  output: shape({ targetId: field.ref.own('target') }),
  principal: 'user',
  *decide(input, ctx) {
    const id = yield* ctx.newId(target);
    return {
      events: [ctx.write.probes.target.create({ id, owner: input.owner })],
      effects: [act(input, { continueWith: record, with: { id } })],
      result: { targetId: id },
    };
  },
});

const record = defineCommand(probesBase, target, {
  input: outcomeOf(act),
  decide: (input, _current, ctx) => [
    ctx.events.recorded({
      result: input.outcome.ok
        ? `ok ${JSON.stringify(input.outcome.value)}`
        : `failed ${input.outcome.error.code}: ${input.outcome.error.message}`,
    }),
  ],
});

const probesDef = defineModule(probesBase, {
  actions: { run, plant },
  entityActions: { target: { record, sign } },
  effects: { act, unseal },
  executors: { act: actExecutor, unseal: unsealExecutor },
  policies: {
    run: { signedIn: defineRule(probesBase, run, { effect: 'allow', principal: 'user' }) },
    plant: { signedIn: defineRule(probesBase, plant, { effect: 'allow', principal: 'user' }) },
    target: {
      writers: defineRule(probesBase, target, {
        effect: 'allow',
        actions: ['write', 'record', 'sign'],
        principal: 'user',
        reason:
          'A signed-in user writes targets; the module itself does through the core default rule.',
      }),
    },
  },
});

/** The test-local module that probes the executor runtime: every failure case runs through one effect. */
export interface Probes extends ModuleType<typeof probesDef> {}
export const probes: Probes = probesDef;
