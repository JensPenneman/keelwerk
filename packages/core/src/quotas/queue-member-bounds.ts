/**
 * What the queue lanes can hold: the PostgreSQL integer columns `cap` and `weight` of kw_job_lanes
 * (packages/data/src/sql/postgres/kw-job-lanes.ts) are 32-bit, a cap of 0 holds the lane (nothing
 * of it is taken), and the fair take divides by the weight, so a weight is at least 1. The one
 * definition of these numbers: `queueOf` (create-quota-cache.ts), `checkedQuotaValue`,
 * `laneLimitsOf` and `checkLaneMembers` read it.
 */
export const queueMemberBounds = { max: 2_147_483_647, minCap: 0, minWeight: 1 } as const;
