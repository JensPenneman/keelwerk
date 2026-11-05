/** One flag of an action command in the CLI manifest. */
export interface CliManifestFlag {
  readonly name: string;
  readonly kind: string;
  readonly required: boolean;
  readonly description?: string;
}
