import {
  core,
  defineApp,
  defineCommand,
  defineEffect,
  defineEffectExecutor,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  errors,
  field,
  outcomeOf,
  settle,
  shape,
} from '@keelwerk/core';

const ledger = defineEntity({
  prefix: 'vlg',
  fields: {
    mode: field.string(),
    ok: field.boolean(),
    code: field.string().optional(),
    proof: field.text().optional(),
  },
});
const vaultBase = defineModuleBase({ id: 'vault', version: '0.1.0', entities: { ledger } });

const members = {
  mode: field.string(),
  key: field.secret(),
  backup: field.secret(),
};
const output = shape({ seal: field.secret(), proof: field.text() });

/** An effect the process performs: it holds two secrets, and its executor reveals `key` and tells what it saw. */
const lock = defineEffect(vaultBase, { input: shape(members), output });
/** The same input performed by an outside performer. */
const hold = defineEffect(vaultBase, { performer: 'external', input: shape(members), output });

/** What a test hangs on the executor: how many attempts ran, and the signal that an attempt is hanging. */
const run: {
  attempts: number;
  hanging: PromiseWithResolvers<void>;
  /** What each attempt of a `script` effect does, by attempt number: `ok` when absent. */
  script: readonly ('ok' | 'fail' | 'unavailable' | 'hang')[];
} = {
  attempts: 0,
  hanging: Promise.withResolvers<void>(),
  script: [],
};

const lockExecutor = defineEffectExecutor(vaultBase, lock, {
  timeout: '5s',
  retry: { limit: 3, delays: ['1s'] },
  run: async (input, ctx) => {
    run.attempts += 1;
    const proof = `${await ctx.secrets.reveal(input.key, 'a test reveals the key')}#${ctx.effect.attempt}`;
    const mode =
      input.mode === 'script' ? (run.script[ctx.effect.attempt - 1] ?? 'ok') : input.mode;
    switch (mode) {
      case 'fail':
        throw errors.validation('The vault refuses.');
      case 'unavailable':
        throw errors.unavailable('Try again.');
      case 'retry':
        // The first attempt is told to try again; the next one reveals again and answers.
        if (ctx.effect.attempt === 1) throw errors.unavailable('Try again.');
        break;
      case 'hang':
        run.hanging.resolve();
        return new Promise<never>((_resolve, reject) => {
          ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true });
        });
      default:
    }
    return { seal: 'seal marker' as never, proof };
  },
});

const recorded = defineCommand(vaultBase, {
  input: outcomeOf(lock, shape({ mode: field.string() })),
  principal: 'service',
  decide: (input, ctx) => ({
    events: [
      ctx.write.vault.ledger.create({
        mode: input.mode,
        ok: input.outcome.ok,
        ...(input.outcome.ok
          ? { proof: input.outcome.value.proof }
          : { code: input.outcome.error.code }),
      }),
    ],
  }),
});

const heldRecorded = defineCommand(vaultBase, {
  input: outcomeOf(hold, shape({ mode: field.string() })),
  principal: 'service',
  decide: (input, ctx) => ({
    events: [
      ctx.write.vault.ledger.create({
        mode: input.mode,
        ok: input.outcome.ok,
        ...(input.outcome.ok ? {} : { code: input.outcome.error.code }),
      }),
    ],
  }),
});

const open = defineCommand(vaultBase, {
  input: shape({
    ...members,
    external: field.boolean().optional(),
    deadline: field.instant().optional(),
  }),
  principal: 'user',
  decide: (input) => {
    const { external, deadline, ...effectInput } = input;
    const options = { with: { mode: input.mode } };
    return {
      effects: [
        external === true
          ? hold(effectInput, {
              continueWith: heldRecorded,
              ...options,
              ...(deadline === undefined ? {} : { deadline }),
            })
          : lock(effectInput, { continueWith: recorded, ...options }),
      ],
    };
  },
});

const report = defineCommand(vaultBase, {
  input: shape({ effectId: field.ref(core, 'effect') }),
  principal: 'user',
  decide: (input) => ({
    effects: [
      settle(input.effectId, { ok: true, value: { seal: 'outside seal', proof: 'reported' } }),
    ],
  }),
});

const vault = defineModule(vaultBase, {
  actions: { open, report, recorded, heldRecorded },
  effects: { lock, hold },
  executors: { lock: lockExecutor },
  policies: {
    open: { signedIn: defineRule(vaultBase, open, { effect: 'allow', principal: 'user' }) },
    report: { signedIn: defineRule(vaultBase, report, { effect: 'allow', principal: 'user' }) },
  },
});

/** A module of one secret-holding effect, performed by the process or by an outside performer, for the cases of what settles an effect. */
const secretsApp = defineApp({ id: 'vault', modules: [vault] });

export { run, secretsApp };
