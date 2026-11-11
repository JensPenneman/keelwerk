import { contracts, defineModuleBase, type ModuleBaseType } from '@keelwerk/core';
import { liveToCore } from './live-to-core.ts';
import { streamTicket } from './tickets/stream-ticket.ts';
import { version } from './version.ts';

const liveBaseDef = defineModuleBase({
  id: 'live',
  version,
  provides: [contracts.live],
  entities: { streamTicket },
  contributions: { toCore: liveToCore },
});

export interface LiveBase extends ModuleBaseType<typeof liveBaseDef> {}
/** The base of the live module: its entities and the contribution to the core. */
export const liveBase: LiveBase = liveBaseDef;
