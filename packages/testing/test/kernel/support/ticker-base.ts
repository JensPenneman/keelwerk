import {
  defineEntity,
  defineError,
  defineModuleBase,
  type EntityType,
  field,
  type ModuleBaseType,
} from '@keelwerk/core';

/** What a tenant command writes: one row per tick or timer firing. */
const tickDef = defineEntity({
  prefix: 'tck',
  fields: { schedule: field.string({ maxLength: 80 }), at: field.string({ maxLength: 40 }) },
});
interface Tick extends EntityType<typeof tickDef> {}
const tick: Tick = tickDef;

/** What a backend command writes: one row per beat, in the backend's own scope. */
const beatDef = defineEntity({
  prefix: 'bet',
  tenancy: 'backend',
  fields: { source: field.string({ maxLength: 80 }), at: field.string({ maxLength: 40 }) },
});
interface Beat extends EntityType<typeof beatDef> {}
const beat: Beat = beatDef;

const tickerBaseDef = defineModuleBase({
  id: 'ticker',
  version: '0.1.0',
  entities: { tick, beat },
});
interface TickerBase extends ModuleBaseType<typeof tickerBaseDef> {}
const tickerBase: TickerBase = tickerBaseDef;

const refused = defineError('ticker.refused', { kind: 'validation', message: 'Refused.' });

export { beat, refused, tick, tickerBase };
