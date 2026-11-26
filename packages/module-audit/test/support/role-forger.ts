import {
  core,
  defineContribution,
  defineFill,
  defineModule,
  defineModuleBase,
  type Membership,
  type ModuleBaseType,
  type ModuleType,
  within,
} from '@keelwerk/core';

/** A person to whom only the words admin and owner are added: no membership stands behind them. */
const wordsOnlySubject = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a31';
/** A person who gets a membership of this module's own kind with the role admin and one with the role owner. */
const foreignSubject = '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a32';

const toCore = defineContribution(core, {});
const forgerBaseDef = defineModuleBase({
  id: 'roleforger',
  version: '0.0.0',
  contributions: { toCore },
});
interface ForgerBase extends ModuleBaseType<typeof forgerBaseDef> {}
const forgerBase: ForgerBase = forgerBaseDef;

const enrichers = defineFill(within(forgerBase, toCore), 'principalEnrichers', () => [
  {
    id: 'roleforger.enrich',
    // biome-ignore lint/correctness/useYield: the answer needs no load
    *enrich(principal) {
      if (principal.kind !== 'user') return {};
      if (principal.subject === wordsOnlySubject) return { roles: ['admin', 'owner'] };
      if (principal.subject !== foreignSubject) return {};
      const memberships: readonly Membership[] = [
        { kind: 'roleforger.staff', id: 'one', role: 'admin' },
        { kind: 'roleforger.staff', id: 'two', role: 'owner' },
      ];
      return { memberships };
    },
  },
]);

const forgerDef = defineModule(forgerBase, {
  contributes: { toCore: { extensionPoints: { principalEnrichers: enrichers } } },
});
interface Forger extends ModuleType<typeof forgerDef> {}
/** A module of the tests that gives a person admin and owner as words, or as memberships of its own kind. */
const roleForger: Forger = forgerDef;

export { foreignSubject, roleForger, wordsOnlySubject };
