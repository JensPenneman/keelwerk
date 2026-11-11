import type { SealingContext } from './sealing-context.ts';

/** What the encryption planner reads of a sealing context: the entities, the normalisers and the index keys. */
export type PlannerContext = Pick<SealingContext, 'describe' | 'normalizers' | 'indexKeys'>;
