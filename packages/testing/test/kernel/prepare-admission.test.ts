import { describe, test } from 'vitest';
import { admissionAtTheLimit, admissionOverTheLimits } from './support/prepare-admission-cases.ts';

describe.each(['memory', 'pglite'] as const)(
  'a command with prepare over its limits on %s',
  (adapter) => {
    test(
      'is refused before prepare runs, and a resend is answered from its receipt',
      {
        timeout: 120_000,
      },
      () => admissionOverTheLimits({ adapter }),
    );

    test(
      'that crosses the limit performs once and the next is refused before prepare',
      {
        timeout: 120_000,
      },
      () => admissionAtTheLimit({ adapter }),
    );
  },
);
