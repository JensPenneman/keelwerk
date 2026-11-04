/** Changes only when a scope's positions cannot continue (a restore, a destructive rebuild); part of every token. */
export interface ScopeEpoch {
  readonly scopeId: string;
  readonly epoch: number;
}
