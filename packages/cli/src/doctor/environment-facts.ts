/** What doctor reads of the machine and the workspace for the environment check (section 13.12). */
export interface EnvironmentFacts {
  /** `process.version` without the `v`. */
  readonly node: string;
  /** The installed `typescript` of the workspace root, which builds. */
  readonly typescript: string | undefined;
  /** The `typescript-6` the CLI itself runs on, which the layout pass and attest use. */
  readonly typescriptSix: string | undefined;
  readonly pnpm: string | undefined;
  /** The version of the root `packageManager` field. */
  readonly pnpmWanted: string | undefined;
  readonly biome: string | undefined;
  /** The `@biomejs/biome` version the installed preset expects (its peer dependency). */
  readonly biomeWanted: string | undefined;
}
