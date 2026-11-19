import type { Contract, ModuleOf, TransportBase, TransportLiteral } from '@keelwerk/core';

/** The module value of the tRPC transport, written out because this package declares isolated declarations. */
export type TrpcModule = ModuleOf<
  TransportBase<'trpc', readonly [Contract<'httpHost', 'deployment'>]>,
  TransportLiteral
>;
