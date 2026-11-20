import type { Contract, ModuleOf, TransportBase, TransportLiteral } from '@keelwerk/core';

/** The module value of the oRPC transport, written out because this package declares isolated declarations. */
export type OrpcModule = ModuleOf<
  TransportBase<'orpc', readonly [Contract<'httpHost', 'deployment'>]>,
  TransportLiteral
>;
