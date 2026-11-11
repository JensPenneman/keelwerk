import { defineVersionChange } from '@keelwerk/core';
import { m2PartsBase } from '../base.ts';
import { task } from '../entities/task.ts';

export const displayName = defineVersionChange(m2PartsBase, {
  since: '1.0.0',
  surface: [{ entity: task, field: 'displayName', renamedFrom: 'name' }],
  fixtures: [{ ref: 'm2-parts.task.create', older: { name: 'a' }, newer: { displayName: 'a' } }],
});
