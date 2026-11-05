/** The flags of `keelwerk init` as the parser hands them over. */
export interface InitFlags {
  readonly scope?: string;
  readonly app?: string;
  readonly module?: string;
  readonly 'dry-run'?: boolean;
}
