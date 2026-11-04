import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { Scope } from '../storage/scope.ts';
import type { PlacementHandle } from './placement-handle.ts';

/** A scope with the placement and namespace its data lives in. */
export interface ScopeTarget {
  readonly scope: Scope;
  readonly namespace: NamespaceRef;
  readonly handle: PlacementHandle;
}
