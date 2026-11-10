import type { NamespaceRef } from '@keelwerk/core';
import { namespaceRef } from './namespace-ref.ts';

/** The reference of the namespace at root `example`, the root of the M1 dump fixture. */
export const exampleNamespace: NamespaceRef = {
  ...namespaceRef,
  id: 'ns-example',
  root: 'example',
};
