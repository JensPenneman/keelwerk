/** The leaf of a `ctx.live.entity` description: the changes of one entity (15.4.2). */
export interface LiveEntitySource {
  readonly kind: 'entity';
  /** 'loans.loan'. */
  readonly entity: string;
  readonly options: {
    readonly where?: unknown;
    readonly ids?: readonly string[];
    readonly fields?: readonly string[];
    readonly includeArchived?: boolean;
    readonly from?: 'now' | 'beginning';
    readonly after?: string;
  };
}
