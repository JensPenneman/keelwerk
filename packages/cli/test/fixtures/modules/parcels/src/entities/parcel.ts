import { defineEntity, type EntityType, field } from '@keelwerk/core';

const parcelDef = defineEntity({ prefix: 'parc', fields: { label: field.string() } });

export interface Parcel extends EntityType<typeof parcelDef> {}
export const parcel: Parcel = parcelDef;
