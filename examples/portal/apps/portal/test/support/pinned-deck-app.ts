import {
  defineApiVersions,
  defineApp,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  defineVersionChange,
  field,
  type ModuleBaseType,
} from '@keelwerk/core';
import { live } from '@keelwerk/live';
import { graphql } from '@keelwerk/transport-graphql';
import { orpc } from '@keelwerk/transport-orpc';
import { rest } from '@keelwerk/transport-rest';
import { trpc } from '@keelwerk/transport-trpc';

const card = defineEntity({
  prefix: 'crd',
  fields: { title: field.string({ maxLength: 100 }) },
});

interface DeckBase extends ModuleBaseType<typeof deckBaseDef> {}
const deckBaseDef = defineModuleBase({ id: 'deck', version: '2.0.0', entities: { card } });
const deckBase: DeckBase = deckBaseDef;

/** The breaking change: the card's `name` is its `title` from the newer API version on. */
const cardTitle = defineVersionChange(deckBase, {
  since: '2.0.0',
  surface: [{ entity: card, field: 'title', renamedFrom: 'name' }],
  fixtures: [{ ref: 'deck.card.create', older: { name: 'A' }, newer: { title: 'A' } }],
});

const deck = defineModule(deckBase, {
  policies: {
    card: {
      users: defineRule(deckBase, card, {
        effect: 'allow',
        actions: ['read', 'write'],
        principal: 'user',
        reason: 'A signed-in user reads and edits cards.',
      }),
    },
  },
  changes: { cardTitle },
});

/** The two API versions of the app: the second adopts the change. */
export const deckVersions = { older: '2026-11-04', head: '2026-11-11' } as const;

/** An app whose module renamed a field between its two API versions, served over all five transports. */
export const pinnedDeckApp = defineApp({
  id: 'pinned-deck',
  modules: [live, deck, rest, graphql, trpc, orpc],
  execution: { 'deck.card.create': 'either' },
  api: defineApiVersions({
    [deckVersions.older]: {},
    [deckVersions.head]: { changes: ['deck.cardTitle'] },
  }),
});
