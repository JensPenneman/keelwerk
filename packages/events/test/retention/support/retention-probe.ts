import type { AppType, EntityType, ModuleBaseType, ModuleType } from '@keelwerk/core';
import {
  defineApp,
  defineCommand,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  defineStream,
  errors,
  field,
  shape,
} from '@keelwerk/core';

const itemDef = defineEntity({
  prefix: 'rti',
  dataSubject: 'owner',
  fields: { owner: field.subject() },
});
interface Item extends EntityType<typeof itemDef> {}
const item: Item = itemDef;

/** A stream that declares a retention: its records go after a day. */
const notesDef = defineStream({
  key: field.ref.own('item'),
  record: shape({ n: field.integer() }),
  readAs: 'item',
  retention: { maxAge: 'P1D' },
});

const probeBaseDef = defineModuleBase({
  id: 'retprobe',
  version: '0.1.0',
  entities: { item },
  streams: { notes: notesDef },
});
interface ProbeBase extends ModuleBaseType<typeof probeBaseDef> {}
const probeBase: ProbeBase = probeBaseDef;

/** Writes an item and a record of its stream, and answers a secret that the receipt keeps sealed. */
const mint = defineCommand(probeBase, {
  input: shape({ label: field.string() }),
  output: shape({ token: field.secret() }),
  principal: 'user',
  *decide(input, ctx) {
    const id = yield* ctx.newId(item);
    return {
      events: [
        ctx.write.retprobe.item.create({ id, owner: ctx.principal.subject }),
        ctx.write.retprobe.notes.append(id, [{ n: 1 }]),
      ],
      result: { token: input.label },
    };
  },
});

/** Fails the same way every time, which leaves a failed receipt. */
const refuse = defineCommand(probeBase, {
  input: shape({ label: field.string() }),
  principal: 'user',
  *decide() {
    yield* [];
    throw errors.forbidden('The probe refuses every call.');
  },
});

/** Runs as a job, which leaves a row of job history. */
const queued = defineCommand(probeBase, {
  execution: 'async',
  input: shape({ label: field.string() }),
  principal: 'user',
  *decide() {
    yield* [];
    return [];
  },
});

const probeDef = defineModule(probeBase, {
  actions: { mint, refuse, queued },
  policies: {
    item: {
      readers: defineRule(probeBase, item, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        reason: 'A signed-in user reads every item.',
      }),
      writers: defineRule(probeBase, item, {
        effect: 'allow',
        actions: ['write'],
        principal: 'user',
        reason: 'A signed-in user writes every item.',
      }),
    },
    mint: { signedIn: defineRule(probeBase, mint, { effect: 'allow', principal: 'user' }) },
    refuse: { signedIn: defineRule(probeBase, refuse, { effect: 'allow', principal: 'user' }) },
    queued: { signedIn: defineRule(probeBase, queued, { effect: 'allow', principal: 'user' }) },
  },
});
interface Probe extends ModuleType<typeof probeDef> {}
const probe: Probe = probeDef;

const probeAppDef = defineApp({ id: 'retention-probe', modules: [probe] as const });
interface ProbeApp extends AppType<typeof probeAppDef> {}

/** A small app for the retention worker: a command that fails, one that answers a secret, and a stream with a declared retention. */
export const retentionProbeApp: ProbeApp = probeAppDef;
