/**
 * The states of the jobs that wait to run (section 9.5.5): scheduled for later, available now, or
 * waiting behind the earlier job of their key; never a running or a dead job. The one place the
 * set is written for the PostgreSQL dialect: the queue statistics, `JobStore.queued`, the queued
 * cap of the commit tail, the pending reads of the key policy and of a cancel, and the partial
 * index of framework step 0005 read it, as an SQL list for `state in ...`.
 */
export const queuedJobStates = `('scheduled', 'available', 'waiting')`;
