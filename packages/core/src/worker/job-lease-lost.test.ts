import { expect, test } from 'vitest';
import { jobLeaseLost } from './job-lease-lost.ts';

test('a lost lease is the registered code, unavailable and not retryable', () => {
  expect(jobLeaseLost()).toMatchObject({
    kind: 'unavailable',
    code: 'core.job_lease_lost',
    retryable: false,
  });
});
