import { contracts, defineCondition } from '@keelwerk/core';

/** The parts auth adds when a module provides the live contract (5.4). */
export const whenLive = defineCondition([contracts.live], {});
