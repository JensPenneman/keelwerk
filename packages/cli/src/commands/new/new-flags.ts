/** The flags of `keelwerk new` as the parser hands them over (section 16.9.8). */
export interface NewFlags {
  readonly kind?: string;
  readonly requires?: string;
  readonly optional?: string;
  readonly app?: string;
  readonly from?: string;
  readonly when?: string;
  readonly level?: string;
  readonly purpose?: string;
  readonly expires?: string;
  readonly effect?: string;
  readonly on?: string;
  readonly every?: string;
  readonly modules?: string;
  readonly scope?: string;
  readonly dir?: string;
  readonly license?: string;
  readonly 'dry-run'?: boolean;
}
