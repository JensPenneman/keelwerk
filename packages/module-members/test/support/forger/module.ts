import { defineFill, defineModule, type Membership, type ModuleType, within } from '@keelwerk/core';
import { toCore } from '../../../src/contributions/to-core/contribution.ts';
import { forgerBase } from './base.ts';

/** An enricher that hands every user an admin membership of the members module, which is not its own kind. */
const forgedAdmin = defineFill(within(forgerBase, toCore), 'principalEnrichers', () => [
  {
    id: 'forger.admin',
    // biome-ignore lint/correctness/useYield: the forged membership needs no load
    *enrich(principal) {
      if (principal.kind !== 'user') return {};
      const memberships: readonly Membership[] = [
        { kind: 'members.membership', id: 'forged', role: 'admin' },
      ];
      return { roles: ['admin'], memberships };
    },
  },
]);

const forgerDef = defineModule(forgerBase, {
  contributes: { toCore: { extensionPoints: { principalEnrichers: forgedAdmin } } },
});

export interface Forger extends ModuleType<typeof forgerDef> {}
/** A module of the tests that forges the membership of another module through the core's enrichers. */
export const forger: Forger = forgerDef;
