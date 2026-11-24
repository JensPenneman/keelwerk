import type { AppType, FlagProvider, ModuleType, SubjectId } from '@keelwerk/core';
import {
  core,
  defineApp,
  defineCommand,
  defineContribution,
  defineEntity,
  defineFlag,
  defineModule,
  defineModuleBase,
  defineRule,
  eraseOwnSubject,
  field,
  shape,
  within,
} from '@keelwerk/core';

/** Whether the erasures of the module's service principal are on hold, and whether the rule that says so fails: the test turns them on and off. */
const erasureHold = { on: false, failing: false };

/** Whether the flag `oes.legalHold` is on for every tenant: the provider below answers it. */
const legalHold = { on: false, failing: false };

/** The answer of the providers below: `oes.legalHold` on while `legalHold.on`, every other flag passed on; the flag's read throws while `legalHold.failing`. */
function legalHoldAnswer(flag: { readonly key: string }, id: string): never | undefined {
  if (flag.key === 'oes.legalHold' && legalHold.failing) throw new Error('the provider is down');
  return flag.key === 'oes.legalHold' && legalHold.on
    ? ({ value: true, variant: 'true', reason: 'STATIC', provider: id } as never)
    : undefined;
}

/** A flag provider of the process that turns `oes.legalHold` on while `legalHold.on`, and passes every other flag on. */
const legalHoldProvider: FlagProvider = {
  id: 'legal-hold',
  sync: true,
  start: () => Promise.resolve(),
  resolve: (flag) => legalHoldAnswer(flag, 'legal-hold'),
};

/** The same provider declared asynchronous: it answers with a promise, so the kernel resolves flags before authorize. */
const legalHoldAsyncProvider: FlagProvider = {
  id: 'legal-hold-async',
  sync: false,
  start: () => Promise.resolve(),
  resolve: (flag) => Promise.resolve(legalHoldAnswer(flag, 'legal-hold-async')),
};

/** A row whose data subject starts as its own id, as an invitation's does, and moves to a person. */
const itemDef = defineEntity({
  prefix: 'oit',
  dataSubject: 'subject',
  fields: {
    subject: field.subject().index(),
    note: field.string().optional().personal(),
    state: field.enum(['open', 'ended']),
  },
});
/** A row owned by a subject, holding no personal value. */
const holderDef = defineEntity({
  prefix: 'oho',
  dataSubject: 'ownerId',
  fields: { ownerId: field.subject().index(), label: field.string({ maxLength: 40 }) },
});
/** A row owned by one subject that holds a personal value of another: it references that subject. */
const mentionDef = defineEntity({
  prefix: 'ome',
  dataSubject: 'ownerId',
  fields: {
    ownerId: field.subject().index(),
    aboutId: field.subject(),
    text: field.string().personal({ subject: 'aboutId' }),
  },
});
const toCore = defineContribution(core, {});

const oesBaseDef = defineModuleBase({
  id: 'oes',
  version: '0.1.0',
  contributions: { toCore },
  entities: { item: itemDef, holder: holderDef, mention: mentionDef },
  flags: {
    legalHold: defineFlag({
      kind: 'boolean',
      default: false,
      level: 'tenant',
      purpose: 'operational',
    }),
  },
});

const makeCommand = defineCommand(oesBaseDef, {
  input: shape({
    id: field.string().optional(),
    subject: field.subject().optional(),
    note: field.string().optional(),
  }),
  output: shape({ itemId: field.ref.own('item') }),
  principal: 'operator',
  *decide(input, ctx) {
    const id = input.id === undefined ? yield* ctx.newId(itemDef) : (input.id as never);
    return {
      events: [
        ctx.write.oes.item.create({
          id,
          subject: input.subject ?? (id as unknown as SubjectId),
          state: 'open',
          ...(input.note === undefined ? {} : { note: input.note }),
        }),
      ],
      result: { itemId: id },
    };
  },
});

/** Ends an item: it asks for the erasure of its own id, and may move the item to a subject in the same decision. */
const endCommand = defineCommand(oesBaseDef, {
  input: shape({ itemId: field.ref.own('item'), moveTo: field.subject().optional() }),
  principal: 'operator',
  *decide(input, ctx) {
    const row = yield* ctx.load.oes.item.byId(input.itemId);
    if (row === undefined) return [];
    return {
      events: [
        ctx.write.oes.item.update(row, {
          state: 'ended',
          ...(input.moveTo === undefined ? {} : { subject: input.moveTo }),
          ...(input.moveTo === undefined || row.note === undefined ? {} : { note: row.note }),
        }),
      ],
      effects: [eraseOwnSubject({ type: 'oes.item', id: input.itemId })],
    };
  },
});

/** Asks for the erasure of the id of any row of the module, ended or not: the request of a row that is no live row is refused. */
const requestCommand = defineCommand(oesBaseDef, {
  input: shape({ itemId: field.string() }),
  principal: 'operator',
  decide(input) {
    return { events: [], effects: [eraseOwnSubject({ type: 'oes.item', id: input.itemId })] };
  },
});

const holdCommand = defineCommand(oesBaseDef, {
  input: shape({ ownerId: field.subject(), label: field.string({ maxLength: 40 }) }),
  principal: 'operator',
  *decide(input, ctx) {
    const id = yield* ctx.newId(holderDef);
    return [ctx.write.oes.holder.create({ id, ownerId: input.ownerId, label: input.label })];
  },
});

const mentionCommand = defineCommand(oesBaseDef, {
  input: shape({ ownerId: field.subject(), aboutId: field.subject(), text: field.string() }),
  principal: 'operator',
  *decide(input, ctx) {
    const id = yield* ctx.newId(mentionDef);
    return [
      ctx.write.oes.mention.create({
        id,
        ownerId: input.ownerId,
        aboutId: input.aboutId,
        text: input.text,
      }),
    ];
  },
});

/** A hold: a deny rule on `core.eraseSubject` that matches the service principals while `erasureHold.on`. */
const holdErasures = defineRule(within(oesBaseDef, toCore), core.actions.eraseSubject, {
  effect: 'deny',
  principal: 'service',
  when: () => {
    if (erasureHold.failing) throw new Error('the hold rule fails');
    return erasureHold.on;
  },
  reason: 'Erasures are on hold.',
});

/** A hold that reads a flag: it matches the service principals while a provider turns `oes.legalHold` on. */
const holdByFlag = defineRule(within(oesBaseDef, toCore), core.actions.eraseSubject, {
  effect: 'deny',
  principal: 'service',
  when: (ctx) => ctx.flags.oes?.legalHold === true,
  reason: 'A legal hold is on.',
});

/** The same hold on the operator's own call of the action. */
const holdOperatorsByFlag = defineRule(within(oesBaseDef, toCore), core.actions.eraseSubject, {
  effect: 'deny',
  principal: 'operator',
  when: (ctx) => ctx.flags.oes?.legalHold === true,
  reason: 'A legal hold is on.',
});

const oesDef = defineModule(oesBaseDef, {
  actions: {
    make: makeCommand,
    end: endCommand,
    request: requestCommand,
    hold: holdCommand,
    speak: mentionCommand,
  },
  contributes: {
    toCore: { policies: { eraseSubject: { holdErasures, holdByFlag, holdOperatorsByFlag } } },
  },
  policies: {
    make: {
      operators: defineRule(oesBaseDef, makeCommand, { effect: 'allow', principal: 'operator' }),
    },
    end: {
      operators: defineRule(oesBaseDef, endCommand, { effect: 'allow', principal: 'operator' }),
    },
    request: {
      operators: defineRule(oesBaseDef, requestCommand, { effect: 'allow', principal: 'operator' }),
    },
    hold: {
      operators: defineRule(oesBaseDef, holdCommand, { effect: 'allow', principal: 'operator' }),
    },
    speak: {
      operators: defineRule(oesBaseDef, mentionCommand, { effect: 'allow', principal: 'operator' }),
    },
  },
});
interface Oes extends ModuleType<typeof oesDef> {}
const oes: Oes = oesDef;

/** A row of another module, to show that a refused request rolls its module's writes back. */
const traceDef = defineEntity({ prefix: 'otr', fields: { text: field.string({ maxLength: 40 }) } });
const intruderBaseDef = defineModuleBase({
  id: 'intruder',
  version: '0.1.0',
  entities: { trace: traceDef },
});
/** Writes a trace row and asks for the erasure of another module's row. */
const askCommand = defineCommand(intruderBaseDef, {
  input: shape({ type: field.string(), id: field.string() }),
  principal: 'operator',
  *decide(input, ctx) {
    const id = yield* ctx.newId(traceDef);
    return {
      events: [ctx.write.intruder.trace.create({ id, text: 'asked' })],
      effects: [eraseOwnSubject({ type: input.type, id: input.id })],
    };
  },
});
const intruderDef = defineModule(intruderBaseDef, {
  actions: { ask: askCommand },
  policies: {
    ask: {
      operators: defineRule(intruderBaseDef, askCommand, {
        effect: 'allow',
        principal: 'operator',
      }),
    },
  },
});
interface Intruder extends ModuleType<typeof intruderDef> {}
const intruder: Intruder = intruderDef;

const ownErasureAppDef = defineApp({ id: 'own-erasure', modules: [oes, intruder] as const });
interface OwnErasureApp extends AppType<typeof ownErasureAppDef> {}
/** An app of two modules: one whose rows end by erasing their own id, and one that tries it on a row that is not its own. */
const ownErasureApp: OwnErasureApp = ownErasureAppDef;

export { erasureHold, legalHold, legalHoldAsyncProvider, legalHoldProvider, ownErasureApp };
