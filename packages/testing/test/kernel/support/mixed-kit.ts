import type { AppType, EntityType, ModuleBaseType } from '@keelwerk/core';
import {
  defineApp,
  defineCommand,
  defineEffect,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  field,
  shape,
} from '@keelwerk/core';

const memberDef = defineEntity({
  prefix: 'memb',
  dataSubject: 'id',
  fields: {
    name: field.string({ maxLength: 100 }),
    email: field.string({ format: 'email' }).personal({ normalize: 'email' }),
  },
});
interface Member extends EntityType<typeof memberDef> {}
const member: Member = memberDef;

const clubBaseDef = defineModuleBase({ id: 'club', version: '0.1.0', entities: { member } });
interface ClubBase extends ModuleBaseType<typeof clubBaseDef> {}
const clubBase: ClubBase = clubBaseDef;

/** An external effect whose `to` member is personal, under the subject the effect names. */
const welcome = defineEffect(clubBase, {
  performer: 'external',
  input: shape({ ownerId: field.subject(), to: field.string().personal() }),
  dataSubject: 'ownerId',
});

/**
 * A command that writes a member row with a personal value and requests an effect with its own
 * personal input.
 */
const join = defineCommand(clubBase, {
  input: shape({
    ownerId: field.subject(),
    name: field.string({ maxLength: 100 }),
    email: field.string({ format: 'email' }),
  }),
  output: shape({}),
  principal: 'user',
  *decide(input, ctx) {
    const id = yield* ctx.newId(member);
    return {
      events: [ctx.write.club.member.create({ id, name: input.name, email: input.email })],
      effects: [welcome({ ownerId: input.ownerId, to: input.email })],
      result: {},
    };
  },
});

const writers = defineRule(clubBase, member, {
  effect: 'allow',
  actions: ['read', 'write'],
  principal: 'user',
  reason: 'A signed-in user reads and writes every member.',
});

const clubDef = defineModule(clubBase, {
  actions: { join },
  effects: { welcome },
  policies: {
    join: { signedIn: defineRule(clubBase, join, { effect: 'allow', principal: 'user' }) },
    member: { writers },
  },
});
const clubAppDef = defineApp({ id: 'club', modules: [clubDef] });

/**
 * The test-local `club` app: one command that writes a row with a personal value and requests a
 * personal effect.
 */
export interface ClubApp extends AppType<typeof clubAppDef> {}
export const clubApp: ClubApp = clubAppDef;
