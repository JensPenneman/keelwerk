import { core, defineModule, defineRule, type ModuleType, within } from '@keelwerk/core';
import { toCore } from '../../../src/contributions/to-core/contribution.ts';
import { holdBase } from './base.ts';

/** A hold: a deny rule on `core.eraseSubject` for service principals while `erasuresHeld.on`. */
const holdErasures = defineRule(within(holdBase, toCore), core.actions.eraseSubject, {
  effect: 'deny',
  principal: 'service',
  when: () => erasuresHeld.on,
  reason: 'Erasures are on hold.',
});

const holdDef = defineModule(holdBase, {
  contributes: { toCore: { policies: { eraseSubject: { holdErasures } } } },
});

export interface Hold extends ModuleType<typeof holdDef> {}
/** A module of the tests that can put the erasures of service principals on hold. */
export const hold: Hold = holdDef;

/** Whether erasures started by a module's service principal are on hold: a test turns it on and off. */
export const erasuresHeld = { on: false };
