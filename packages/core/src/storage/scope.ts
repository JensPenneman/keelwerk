import type { StorageScope } from './storage-scope.ts';

/** A storage scope without the kernel-internal namespace level: what module code and events can name. */
export type Scope = Exclude<StorageScope, { readonly level: 'namespace' }>;
