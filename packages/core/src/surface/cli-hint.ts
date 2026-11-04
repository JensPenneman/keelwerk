export interface CliHint {
  readonly route?: readonly string[];
  readonly aliases?: readonly string[];
  readonly positional?: readonly string[];
  readonly login?: { readonly tokenField: string };
}
