import { defineEntity, type EntityType, field } from '@keelwerk/core';

const ledgerDef = defineEntity({ prefix: 'ledg', fields: { name: field.string() } });

export interface Ledger extends EntityType<typeof ledgerDef> {}
export const ledger: Ledger = ledgerDef;
