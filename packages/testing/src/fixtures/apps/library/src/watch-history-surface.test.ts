import {
  defineApp,
  defineEntity,
  defineModule,
  defineModuleBase,
  deriveSurface,
  field,
} from '@keelwerk/core';
import { checkRestSurface } from '@keelwerk/transport-rest';
import { expect, test } from 'vitest';

const noteDef = defineEntity({
  prefix: 'note',
  dataSubject: 'author',
  fields: { text: field.string({ maxLength: 200 }), author: field.subject().index() },
  generated: { history: true, watch: true },
});

const notesBase = defineModuleBase({
  id: 'notes',
  version: '0.1.0',
  generates: ['watch'],
  entities: { note: noteDef },
});
const notes = defineModule(notesBase, { actions: {}, policies: {} });
const app = defineApp({ id: 'notes-app', modules: [notes] });

test('generated watch and history project to REST with shape inputs', () => {
  const derived = deriveSurface(app, '2026-11-04');
  expect(derived.problems.filter((problem) => problem.severity === 'error')).toEqual([]);
  const { surface } = derived;
  expect(checkRestSurface(surface)).toEqual([]);
  for (const ref of ['notes.note.watch', 'notes.note.history']) {
    const action = surface.actions.find((candidate) => candidate.ref === ref);
    expect(action, ref).toBeDefined();
    expect(action?.input.kind, ref).toBe('shape');
  }
});
