import type { NamespaceIdentity } from './namespace-identity.ts';

/** The rows of kw__control.kw_namespace_identities (14.7.6, S-119). */
export interface NamespaceIdentities {
  all(): Promise<readonly NamespaceIdentity[]>;
  /** Inserts or replaces the namespace's row. */
  record(identity: NamespaceIdentity): Promise<void>;
}
