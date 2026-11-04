import { defineEntity } from '../../../define-entity.ts';
import { field } from '../../../field.ts';
import { shape } from '../../../shape.ts';

export const delivery = defineEntity({
  prefix: 'hdl',
  fields: {
    body: field.text(),
    status: field.enum(['pending', 'delivered', 'failed']).default('pending'),
    responseStatus: field.integer().optional(),
  },
  events: {
    settled: shape({
      status: field.enum(['delivered', 'failed']),
      responseStatus: field.integer().optional(),
    }),
  },
  evolve: {
    settled: (state, event) => ({
      ...state,
      status: event.status,
      responseStatus: event.responseStatus,
    }),
  },
});
