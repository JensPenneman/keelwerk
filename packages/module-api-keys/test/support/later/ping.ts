import { defineCommand, field, shape } from '@keelwerk/core';
import { laterBase } from './base.ts';

/** Work for the module's own principal: it decides nothing, so a test sees only that the job ran and how it ended. */
const pingDef = defineCommand(laterBase, {
  input: shape({ note: field.string() }),
  principal: 'service',
  execution: 'sync',
  decide: () => ({ events: [] }),
});

type PingPart = typeof pingDef;
export interface Ping extends PingPart {}
export const ping: Ping = pingDef;
