import { describe, test } from 'vitest';
import { effectTenancyCase } from './support/effect-tenancy-case.ts';

describe.each(['memory', 'pglite'] as const)(
  'core.effect is scoped to its tenant on %s',
  (adapter) => {
    test("a tenant finds none of the other tenant's effects and cannot update one", {
      timeout: 90_000,
    }, async () => {
      await effectTenancyCase({ adapter });
    });
  },
);
