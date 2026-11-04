import { defineEntity, type EntityType, field, shape } from '@keelwerk/core';

const deliveryDef = defineEntity({
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

export interface Delivery extends EntityType<typeof deliveryDef> {}
export const delivery: Delivery = deliveryDef;
