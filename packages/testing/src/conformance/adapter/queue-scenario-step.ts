/**
 * What one attempt of a scenario job does. `succeed`: writes its row and completes in one unit of the
 * job's scope. `fail`: throws errors.unavailable before any unit. `hold`: waits for `resume(n)` outside
 * any unit, then succeeds. `holdInUnit`: opens the unit with `signal: job.signal`, waits for `resume(n)`
 * inside it, then succeeds.
 */
export type QueueScenarioStep = 'succeed' | 'fail' | 'hold' | 'holdInUnit';
