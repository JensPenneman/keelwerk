import { contracts, defineCondition } from '@keelwerk/core';

export const whenLive = defineCondition([contracts.live], {});
