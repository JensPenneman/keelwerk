/**
 * What the queue lanes can hold: the PostgreSQL integer columns `cap` and `weight` of kw_job_lanes
 * (packages/data/src/sql/postgres/kw-job-lanes.ts) are 32-bit, and the fair take divides by the
 * weight, so a weight is at least 1.
 */
export const queueMemberBounds = { max: 2_147_483_647, minWeight: 1 } as const;
