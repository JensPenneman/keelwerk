/** What a new project is called (section 23.1). */
export interface InitNames {
  /** The package scope, `@acme`. */
  readonly scope: string;
  /** The project's name: the last segment of the root package, `platform`. */
  readonly project: string;
  /** The id of the one app, `apps/<app>`. */
  readonly app: string;
  /** The id of the one module, `modules/<module>`. */
  readonly module: string;
}
