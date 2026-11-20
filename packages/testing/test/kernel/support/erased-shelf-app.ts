import type { AppType, EntityType, ModuleBaseType, ModuleType } from '@keelwerk/core';
import {
  contracts,
  defineApp,
  defineCommand,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  field,
  shape,
} from '@keelwerk/core';
import { live } from '@keelwerk/live';

const noteDef = defineEntity({
  prefix: 'nte',
  dataSubject: 'ownerId',
  fields: {
    title: field.string({ maxLength: 100 }),
    ownerId: field.subject().index(),
    secret: field.string().optional().personal(),
  },
  generated: { history: true, watch: true },
});
interface Note extends EntityType<typeof noteDef> {}
const note: Note = noteDef;

const shelfBaseDef = defineModuleBase({
  id: 'shelf',
  version: '0.1.0',
  generates: ['watch'],
  requires: [contracts.live],
  entities: { note },
});
interface ShelfBase extends ModuleBaseType<typeof shelfBaseDef> {}
const shelfBase: ShelfBase = shelfBaseDef;

const put = defineCommand(shelfBase, {
  input: shape({ ownerId: field.subject(), title: field.string(), secret: field.string() }),
  output: shape({ noteId: field.ref.own('note') }),
  principal: 'operator',
  *decide(input, ctx) {
    const id = yield* ctx.newId(note);
    return {
      events: [
        ctx.write.shelf.note.create({
          id,
          ownerId: input.ownerId,
          title: input.title,
          secret: input.secret,
        }),
      ],
      result: { noteId: id },
    };
  },
});

const shelfDef = defineModule(shelfBase, {
  actions: { put },
  policies: {
    put: { operators: defineRule(shelfBase, put, { effect: 'allow', principal: 'operator' }) },
    note: {
      readers: defineRule(shelfBase, note, {
        effect: 'allow',
        actions: ['read'],
        principal: ['user', 'operator'],
        reason: 'Everyone reads the notes.',
      }),
    },
  },
});
interface Shelf extends ModuleType<typeof shelfDef> {}
const shelf: Shelf = shelfDef;

const erasedShelfAppDef = defineApp({
  id: 'rebuild-erased-shelf',
  modules: [live, shelf] as const,
});
interface ErasedShelfApp extends AppType<typeof erasedShelfAppDef> {}

/** An app with one `history: 'chain'` entity whose rows belong to a data subject, for erasure under a rebuild. */
export const erasedShelfApp: ErasedShelfApp = erasedShelfAppDef;
