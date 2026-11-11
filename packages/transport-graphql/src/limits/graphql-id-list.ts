/** A list of ids the document sends to `nodes` or to a `...Get` field, and the most ids that field takes. */
export interface GraphqlIdList {
  readonly field: string;
  readonly count: number;
  readonly max: number;
}
