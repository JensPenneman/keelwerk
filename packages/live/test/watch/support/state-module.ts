import type { ModuleBaseType, ModuleType } from '@keelwerk/core';
import {
  contracts,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  field,
} from '@keelwerk/core';

/** An entity whose history is its state: its change records are transient (15.1.10). */
const note = defineEntity({
  prefix: 'note',
  fields: { owner: field.string().index(), text: field.string() },
  history: 'state',
  reason: 'A note is replaced, not audited; the watch follows its transient change records.',
});

interface StateBase extends ModuleBaseType<typeof stateBaseDef> {}

const stateBaseDef = defineModuleBase({
  id: 'jotter',
  version: '0.1.0',
  requires: [contracts.live],
  entities: { note },
});
const stateBase: StateBase = stateBaseDef;

const stateDef = defineModule(stateBase, {
  policies: {
    note: {
      everyone: defineRule(stateBase, note, {
        effect: 'allow',
        actions: ['read', 'write'],
        principal: 'user',
      }),
    },
  },
});

/** A module with one `history: 'state'` entity. */
export interface Jotter extends ModuleType<typeof stateDef> {}

/** The module of the state-entity watch test. */
export const jotter: Jotter = stateDef;
