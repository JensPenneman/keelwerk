import { contracts, defineTransportModule, field, shape } from '@keelwerk/core';
import { expectTypeOf, test } from 'vitest';
import { createGraphqlAdapter } from './create-graphql-adapter.ts';
import { graphql } from './module.ts';

const inferred = () =>
  defineTransportModule({
    id: 'graphql',
    requires: [contracts.httpHost],
    config: shape({
      cors: field.list(field.string()).default([]),
      maxBodyBytes: field.integer({ min: 1024 }).default(1_048_576),
    }),
    transport: createGraphqlAdapter(),
  });

test('GraphqlModule is the type defineTransportModule infers for the graphql module', () => {
  expectTypeOf(graphql).toEqualTypeOf<ReturnType<typeof inferred>>();
});
