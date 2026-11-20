import {
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  type EntityType,
  field,
  type ModuleBaseType,
  type ModuleType,
} from '@keelwerk/core';

const noteDef = defineEntity({
  prefix: 'note',
  fields: { title: field.string({ maxLength: 200 }) },
});
interface Note extends EntityType<typeof noteDef> {}
const note: Note = noteDef;

const notesBaseDef = defineModuleBase({ id: 'notes', version: '0.1.0', entities: { note } });
interface NotesBase extends ModuleBaseType<typeof notesBaseDef> {}
const notesBase: NotesBase = notesBaseDef;

const people = defineRule(notesBase, note, {
  effect: 'allow',
  actions: ['create', 'read'],
  principal: 'user',
  reason: 'A signed-in user writes and reads notes.',
});

const notesDef = defineModule(notesBase, { policies: { note: { people } } });
interface Notes extends ModuleType<typeof notesDef> {}
/** A module whose notes leave an event each time: the thing the audit module watches in the alone tests. */
export const auditNotes: Notes = notesDef;
