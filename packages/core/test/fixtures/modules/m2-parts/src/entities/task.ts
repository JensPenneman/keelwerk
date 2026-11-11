import { defineEntity, type EntityType, field, shape } from '@keelwerk/core';

const taskDef = defineEntity({
  prefix: 'pjb',
  fields: {
    displayName: field.string(),
    step: field.integer().default(0),
  },
  events: {
    renamed: shape({ displayName: field.string() }),
  },
  evolve: {
    renamed: (state, event) => ({ ...state, displayName: event.displayName }),
  },
});

export interface Task extends EntityType<typeof taskDef> {}
export const task: Task = taskDef;
