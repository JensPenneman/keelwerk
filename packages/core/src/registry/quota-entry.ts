import type { QuotaKind } from '../dsl/quota.ts';

/** A quota dimension a module declares (section 12.2). */
export interface QuotaEntry {
  /** '<module>.<name>', 'core.storageBytes'. */
  readonly ref: string;
  readonly module: string;
  readonly name: string;
  readonly kind: QuotaKind;
  readonly default: string | number;
  readonly level: 'backend' | 'tenant';
}
