import { describe, expect, test } from 'vitest';
import type { ControlStore } from '../control/control-store.ts';
import type { ScopeLookup } from '../invoker/scope-lookup.ts';
import { checkQuotaInput } from './check-quota-input.ts';
import type { QuotaCheck } from './quota-check.ts';

const lookup: ScopeLookup = {
  hostname: () => {
    throw new Error('read');
  },
  backend: () => {
    throw new Error('the backend was read');
  },
  tenant: () => {
    throw new Error('read');
  },
};
const control = {
  read: () => {
    throw new Error('the control store was read');
  },
} as unknown as ControlStore;

function checkOf(tenantId: unknown): QuotaCheck {
  return {
    dimension: 'queue:commands.weight',
    backendId: 'b1',
    tenantId,
    limit: '2',
    reason: 'x',
  } as QuotaCheck;
}

describe('checkQuotaInput', () => {
  test('a check without a tenant is refused before any read', async () => {
    for (const tenantId of [undefined, null, '', 5]) {
      await expect(
        checkQuotaInput({
          check: checkOf(tenantId),
          deployment: {},
          served: [],
          control,
          lookup,
        }),
      ).rejects.toMatchObject({ kind: 'validation', code: 'core.malformed_request' });
    }
  });
});
