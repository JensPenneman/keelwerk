import type { Condition } from '../conditions/condition.ts';

/** The condition every row meets: an empty `and`. */
export const alwaysCondition: Condition = { op: 'and', conditions: [] };
