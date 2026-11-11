import type { ModuleBaseType, ModuleType } from '@keelwerk/core';
import {
  contracts,
  defineCommand,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  defineSubscription,
  field,
  mapItems,
  relation,
  shape,
} from '@keelwerk/core';

const deck = defineEntity({
  prefix: 'deck',
  fields: { owner: field.string().index(), cardId: field.ref.own('card').index() },
});

const card = defineEntity({
  prefix: 'card',
  fields: {
    owner: field.string().index(),
    title: field.string(),
    shown: field.boolean().default(true).index(),
    note: field.string().optional().maskable(),
  },
  relations: { decks: relation.many.own('deck', { by: 'cardId', to: 'id' }) },
});

interface BoardBase extends ModuleBaseType<typeof boardBaseDef> {}

const boardBaseDef = defineModuleBase({
  id: 'board',
  version: '0.1.0',
  requires: [contracts.live],
  entities: { card, deck },
});
const boardBase: BoardBase = boardBaseDef;

/** One flat event for every kind of change, so a test reads what a subscriber was told. */
const cards = defineSubscription(boardBase, {
  event: shape({
    type: field.enum(['created', 'changed', 'restored', 'archived', 'removed']),
    cardId: field.string(),
    version: field.integer().optional(),
    reason: field.string().optional(),
    cause: field.string().optional(),
    title: field.string().optional(),
    note: field.string().optional(),
    masked: field.string().optional(),
  }),
  input: shape({
    from: field.enum(['now', 'beginning']).optional(),
    shownOnly: field.boolean().optional(),
    includeArchived: field.boolean().optional(),
    ids: field.list(field.string()).optional(),
  }),
  principal: 'user',
  source: (input, ctx, resume) =>
    mapItems(
      ctx.live.entity('board', 'card', {
        ...(input.shownOnly === true ? { where: { shown: true } } : {}),
        ...(input.includeArchived === true ? { includeArchived: true } : {}),
        ...(input.ids === undefined ? {} : { ids: input.ids }),
        from: input.from ?? 'now',
        after: resume,
      }),
      (change) => {
        if (change.type === 'removed') {
          return { type: change.type, cardId: change.id, reason: change.reason };
        }
        const row = change.row as
          | {
              readonly title?: string;
              readonly note?: string;
              readonly $masked?: readonly string[];
            }
          | undefined;
        return {
          type: change.type,
          cardId: change.id,
          version: change.version,
          ...(change.cause === undefined ? {} : { cause: change.cause }),
          ...(row?.title === undefined ? {} : { title: row.title }),
          ...(row?.note === undefined ? {} : { note: row.note }),
          ...(row?.$masked === undefined ? {} : { masked: row.$masked.join(',') }),
        };
      },
    ),
});

/** Changes a deck and its card in one decision, so one batch holds a related change and a change of the card. */
const handOver = defineCommand(boardBase, {
  input: shape({
    cardId: field.ref.own('card'),
    deckId: field.ref.own('deck'),
    owner: field.string(),
    title: field.string(),
  }),
  output: shape({}),
  principal: 'user',
  decide(input, ctx) {
    return {
      events: [
        ctx.write.board.deck.update(input.deckId, { owner: input.owner }),
        ctx.write.board.card.update(input.cardId, { title: input.title }),
      ],
      result: {},
    };
  },
});

const boardDef = defineModule(boardBase, {
  actions: { cards, handOver },
  policies: {
    card: {
      // The owner sees the note of the cards that are shown.
      owners: defineRule(boardBase, card, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        where: (ctx) => ({ owner: ctx.principal.subject, shown: true }),
        fields: ['note'],
      }),
      // A viewer sees every shown card but never its note.
      viewers: defineRule(boardBase, card, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        where: (ctx) => (ctx.principal.roles.includes('viewer') ? { shown: true } : false),
        fields: [],
      }),
      // The owner of a deck on the card sees it, whatever its own state: a rule over a relation.
      deckOwners: defineRule(boardBase, card, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        where: (ctx) => ({ decks: { some: { owner: ctx.principal.subject } } }),
      }),
      // The seeding subject reads what it writes (a command's output passes the read plan, 8.4).
      seed: defineRule(boardBase, card, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
        where: (ctx) => (ctx.principal.claims.seed === true ? {} : false),
      }),
      writers: defineRule(boardBase, card, {
        effect: 'allow',
        actions: ['write'],
        principal: 'user',
      }),
    },
    deck: {
      all: defineRule(boardBase, deck, {
        effect: 'allow',
        actions: ['read', 'write'],
        principal: 'user',
      }),
    },
    cards: {
      users: defineRule(boardBase, cards, { effect: 'allow', principal: 'user' }),
    },
    handOver: {
      users: defineRule(boardBase, handOver, { effect: 'allow', principal: 'user' }),
    },
  },
});

/** A module with two entities and one subscription over the changes of cards, for the tests of the hub. */
export interface Board extends ModuleType<typeof boardDef> {}

/** The test module. */
export const board: Board = boardDef;
