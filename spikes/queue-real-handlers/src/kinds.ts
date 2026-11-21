import { touchQueue } from './bench-touch.ts';

/** The three real handlers of 9.5.7: a command job, a reaction job and an effect job. */
export const kinds = ['command', 'reaction', 'effect'] as const;
export type Kind = (typeof kinds)[number];

/** The queue each kind's jobs wait in: the kernel's own for commands and reactions, the executor's for effects. */
export const queueOf: Readonly<Record<Kind, string>> = {
  command: 'commands',
  reaction: 'reactions',
  effect: touchQueue,
};

/** The tenants of the measurement: the lanes the jobs spread over. */
export const tenantNames = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'] as const;

/** The worker processes of the measurement (9.5.7: four workers). */
export const workerCount = 4;

/** The lane cap of the kernel (create-kernel-queue.ts): the most one tenant's jobs of a queue run at once. */
export const laneCap = 4;

/**
 * The table a kind's handler writes one row to per job, which the measurement counts to see that the
 * handler ran: the effect's executor writes nothing, its job's outcome is all there is to see.
 */
export const writtenBy: Readonly<Record<Kind, string | undefined>> = {
  command: 'bench__item',
  reaction: 'watch__mark',
  effect: undefined,
};
