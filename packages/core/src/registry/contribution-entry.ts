/** What one module contributes to another (section 5.3), after `when` lists are resolved against the selection. */
export interface ContributionEntry {
  /** 'auth->accounts'. */
  readonly id: string;
  /** The contributing module. */
  readonly from: string;
  /** The target module. */
  readonly to: string;
  /** Modules that must be selected for the contribution to count. */
  readonly when: readonly string[];
  /** False when a `when` module is not selected: kept for the composition report, applied nowhere. */
  readonly active: boolean;
  /** Why an inactive contribution was dropped (section 16.2.6); absent when active. */
  readonly droppedBecause?: 'targetAbsent' | 'whenUnsatisfied';
  /** Entity reference to the names of the fields and relations contributed. */
  readonly fields: Readonly<Record<string, readonly string[]>>;
  readonly actions: readonly string[];
  readonly rules: readonly string[];
  readonly reactions: readonly string[];
  /** Extension point references filled. */
  readonly fills: readonly string[];
}
