/** The resolution of one flag, with its reason (section 20.3); M1 answers the declared default with reason `default`. */
export interface FlagResolution {
  readonly value: boolean | string;
  readonly reason: string;
}
