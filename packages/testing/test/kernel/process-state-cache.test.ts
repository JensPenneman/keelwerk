import { describe } from 'vitest';
import { processStateCacheCases } from './support/process-state-cache-cases.ts';

describe.each(['memory', 'pglite'] as const)('the process state cache on %s', (adapter) => {
  processStateCacheCases({ adapter });
});
