import { describe, expectTypeOf, it } from 'vitest';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import { defineError } from './define-error.ts';
import type { AnyErrorDefinition } from './error-definition.ts';
import type { ErrorThrowOptions } from './error-throw-options.ts';

declare const schema: StandardSchemaV1<unknown, { readonly email: string }>;

describe('defineError types', () => {
  it('requires details exactly when a data schema is declared', () => {
    const withData = defineError('accounts.email_taken', {
      kind: 'conflict',
      data: schema,
      message: 'x',
    });
    const without = defineError('accounts.slow', { kind: 'unavailable', message: 'x' });
    expectTypeOf(withData.code).toEqualTypeOf<'accounts.email_taken'>();
    expectTypeOf<Parameters<typeof withData>[0]>().toEqualTypeOf<{ readonly email: string }>();
    expectTypeOf<Parameters<typeof without>>().toEqualTypeOf<[options?: ErrorThrowOptions]>();
  });

  it('lets one list hold definitions with and without data', () => {
    const withData = defineError('accounts.email_taken', {
      kind: 'conflict',
      data: schema,
      message: 'x',
    });
    const without = defineError('accounts.slow', { kind: 'unavailable', message: 'x' });
    const list: readonly AnyErrorDefinition[] = [withData, without];
    expectTypeOf(list).toEqualTypeOf<readonly AnyErrorDefinition[]>();
  });
});
