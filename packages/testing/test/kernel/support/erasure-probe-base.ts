import type { EntityType, ModuleBaseType } from '@keelwerk/core';
import {
  core,
  defineContribution,
  defineEntity,
  defineFlag,
  defineModuleBase,
  defineStream,
  field,
  shape,
} from '@keelwerk/core';

const personDef = defineEntity({
  prefix: 'ppr',
  dataSubject: 'id',
  fields: {
    name: field.string({ maxLength: 100 }),
    email: field
      .string({ format: 'email' })
      .unique()
      .personal({ normalize: 'email', queries: ['prefix'] }),
    notes: field.string().optional().personal(),
    vip: field.boolean().optional().personal(),
    token: field.secret().optional(),
  },
});
interface Person extends EntityType<typeof personDef> {}
const person: Person = personDef;

/** Owned by `ownerId`; its `reply` is the personal value of another subject, `replierId`. */
const threadDef = defineEntity({
  prefix: 'pth',
  dataSubject: 'ownerId',
  fields: {
    title: field.string({ maxLength: 100 }),
    topic: field.string().optional().personal(),
    ownerId: field.subject(),
    replierId: field.subject().optional(),
    reply: field.string().optional().personal({ subject: 'replierId' }),
  },
});
interface Thread extends EntityType<typeof threadDef> {}
const thread: Thread = threadDef;

/**
 * A row the subject owns that holds no personal value: the session a user signs in under. Its id is
 * the principal id the user's requests are stored by, so an erasure must reach the receipts and
 * jobs that name it.
 */
const sessionDef = defineEntity({
  prefix: 'pse',
  dataSubject: 'ownerId',
  fields: { ownerId: field.subject().index(), kind: field.string({ maxLength: 20 }) },
});
interface Session extends EntityType<typeof sessionDef> {}
const session: Session = sessionDef;

/** Records of a thread: a personal element of a list, sealed under the thread owner's key. */
const notesDef = defineStream({
  key: field.ref.own('thread'),
  record: shape({ n: field.integer(), tags: field.list(field.string().personal()) }),
  readAs: 'thread',
});

/** What the probe adds to the core: its rule on `core.eraseSubject` (section 8.7). */
const toCore = defineContribution(core, {});

const probeBaseDef = defineModuleBase({
  id: 'probe',
  version: '0.1.0',
  contributions: { toCore },
  entities: { person, thread, session },
  streams: { notes: notesDef },
  flags: {
    beta: defineFlag({
      kind: 'boolean',
      default: false,
      level: 'tenant',
      purpose: 'release',
      expires: '2027-06-30',
    }),
  },
});
interface ProbeBase extends ModuleBaseType<typeof probeBaseDef> {}
const probeBase: ProbeBase = probeBaseDef;

/** The entities, the contribution and the base of the probe module, which the commands of the module build on. */
export {
  person as probePerson,
  probeBase,
  session as probeSession,
  thread as probeThread,
  toCore as probeToCore,
};
