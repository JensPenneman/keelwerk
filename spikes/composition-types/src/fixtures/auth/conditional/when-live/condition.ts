import { contracts } from '../../../../contracts.ts';
import { defineCondition } from '../../../../define-condition.ts';

export const whenLive = defineCondition([contracts.live], {});
