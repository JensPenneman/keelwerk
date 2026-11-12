import { defineApp, type Id } from '@keelwerk/core';
import { library, loans } from '@keelwerk/testing/fixtures';
import type { ExpectValidApp, HasAction, HasEntity } from '@keelwerk/testing/types';
import { describe, expectTypeOf, test } from 'vitest';
import type { Create } from './actions/create.ts';
import { type ApiKeys, apiKeys } from './module.generated.ts';

describe('the api-keys manifest', () => {
  test('is the module api-keys', () => {
    expectTypeOf<ApiKeys['id']>().toEqualTypeOf<'api-keys'>();
  });

  test('api-keys alone and beside other modules', () => {
    const alone = defineApp({ id: 'alone', modules: [apiKeys] as const });
    expectTypeOf<ExpectValidApp<typeof alone>>().toEqualTypeOf<true>();
    expectTypeOf<HasEntity<typeof alone, 'api-keys.key'>>().toEqualTypeOf<true>();
    expectTypeOf<
      HasAction<
        typeof alone,
        'api-keys.create' | 'api-keys.key.revoke' | 'api-keys.recordUse' | 'api-keys.repinKey'
      >
    >().toEqualTypeOf<true>();
    const beside = defineApp({ id: 'beside', modules: [apiKeys, library, loans] as const });
    expectTypeOf<ExpectValidApp<typeof beside>>().toEqualTypeOf<true>();
  });

  test('create shows the key once, as text, beside the id of the new row', () => {
    type Output = NonNullable<Create['~types']>['output'];
    expectTypeOf<Output['key']>().toEqualTypeOf<string>();
    expectTypeOf<Output['id']>().toEqualTypeOf<Id<'api-keys.key'>>();
    expectTypeOf<Output['publicId']>().toEqualTypeOf<string>();
  });
});
