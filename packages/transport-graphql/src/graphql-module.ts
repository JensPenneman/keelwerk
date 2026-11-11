import type { Contract, ModuleOf, TransportBase, TransportLiteral } from '@keelwerk/core';

/** The module value of the GraphQL transport, written out because this package declares isolated declarations. */
export type GraphqlModule = ModuleOf<
  TransportBase<'graphql', readonly [Contract<'httpHost', 'deployment'>]>,
  TransportLiteral
>;
