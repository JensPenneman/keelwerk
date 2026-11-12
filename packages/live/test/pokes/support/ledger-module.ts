import type { ModuleBaseType, ModuleType } from '@keelwerk/core';
import {
  contracts,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  field,
} from '@keelwerk/core';

/** An entry that only its owner reads: a plan with a row condition and no relation. */
const entry = defineEntity({
  prefix: 'led',
  fields: { owner: field.string().index(), amount: field.integer() },
});

/** A note of the same owner rule whose watch is switched off: no caller can follow it. */
const note = defineEntity({
  prefix: 'nte',
  fields: { owner: field.string().index(), text: field.string() },
  generated: { watch: false },
});

interface LedgerBase extends ModuleBaseType<typeof ledgerBaseDef> {}

const ledgerBaseDef = defineModuleBase({
  id: 'ledger',
  version: '0.1.0',
  requires: [contracts.live],
  entities: { entry, note },
});
const ledgerBase: LedgerBase = ledgerBaseDef;

const ledgerDef = defineModule(ledgerBase, {
  policies: {
    entry: {
      // The owner reads the entries of the owner.
      owners: defineRule(ledgerBase, entry, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        where: (ctx) => ({ owner: ctx.principal.subject }),
      }),
      // The seeding subject reads what it writes (a command's output passes the read plan, 8.4).
      seed: defineRule(ledgerBase, entry, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        where: (ctx) => (ctx.principal.claims.seed === true ? {} : false),
      }),
      writers: defineRule(ledgerBase, entry, {
        effect: 'allow',
        actions: ['write'],
        principal: 'user',
      }),
    },
    note: {
      owners: defineRule(ledgerBase, note, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        where: (ctx) => ({ owner: ctx.principal.subject }),
      }),
      seed: defineRule(ledgerBase, note, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        where: (ctx) => (ctx.principal.claims.seed === true ? {} : false),
      }),
      writers: defineRule(ledgerBase, note, {
        effect: 'allow',
        actions: ['write'],
        principal: 'user',
      }),
    },
  },
});

/** A module with an entity whose rows each belong to one owner, and one that cannot be watched. */
export interface OwnedEntries extends ModuleType<typeof ledgerDef> {}

/** The module of the pokes tests that need a row rule. */
export const ownedEntries: OwnedEntries = ledgerDef;
