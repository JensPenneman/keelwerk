import type { AppType, EntityType, ModuleBaseType, ModuleType } from '@keelwerk/core';
import {
  contracts,
  defineApp,
  defineCommand,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  defineSubscription,
  field,
  mapItems,
  shape,
} from '@keelwerk/core';
import { live } from '@keelwerk/live';

const noteDef = defineEntity({ prefix: 'note', fields: { text: field.string({ maxLength: 80 }) } });
interface Note extends EntityType<typeof noteDef> {}
const note: Note = noteDef;

const journalBaseDef = defineModuleBase({
  id: 'journal',
  version: '0.1.0',
  requires: [contracts.live],
  entities: { note },
});
interface JournalBase extends ModuleBaseType<typeof journalBaseDef> {}
const journalBase: JournalBase = journalBaseDef;

const record = defineCommand(journalBase, {
  input: shape({ text: field.string({ maxLength: 80 }) }),
  output: shape({ noteId: field.ref.own('note') }),
  principal: 'user',
  *decide(input, ctx) {
    const id = yield* ctx.newId(note);
    return {
      events: [ctx.write.journal.note.create({ id, text: input.text })],
      result: { noteId: id },
    };
  },
});

const notes = defineSubscription(journalBase, {
  event: shape({ type: field.string(), noteId: field.string() }),
  principal: 'user',
  source: (_input, ctx, resume) =>
    mapItems(
      ctx.live.entity('journal', 'note', { from: 'beginning', after: resume }),
      (change) => ({ type: change.type, noteId: change.id }),
    ),
});

const journalDef = defineModule(journalBase, {
  actions: { record, notes },
  policies: {
    record: { open: defineRule(journalBase, record, { effect: 'allow', principal: 'user' }) },
    notes: { open: defineRule(journalBase, notes, { effect: 'allow', principal: 'user' }) },
    note: {
      readers: defineRule(journalBase, note, {
        effect: 'allow',
        actions: ['read'],
        principal: 'user',
      }),
    },
  },
});
interface Journal extends ModuleType<typeof journalDef> {}
const journal: Journal = journalDef;

const appDef = defineApp({ id: 'restore-live', modules: [live, journal] as const });

/** A small app with a live subscription over one entity, for the tests that resume a stream after a restore. */
export interface RestoreLiveApp extends AppType<typeof appDef> {}
export const restoreLiveApp: RestoreLiveApp = appDef;
