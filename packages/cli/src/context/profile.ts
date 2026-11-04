/** One entry of `profiles.json` (section 16.9.6). */
export interface Profile {
  readonly url: string;
  readonly backend?: string;
  readonly tenant?: string;
  /** The key in `credentials.json`; defaults to the profile's name. */
  readonly credential?: string;
}
