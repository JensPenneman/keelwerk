/** A type a transport adds to the app's generated file (section 13.7): the names it imports and its declaration. */
export interface TypeFragment {
  /** The package the names come from, for example '@keelwerk/transport-trpc'. */
  readonly module: string;
  /** Imported as types, written the way an import specifier is, `TrpcRouterOf` or `A as B`. */
  readonly names: readonly string[];
  /** One exported declaration without the trailing semicolon: `export type TrpcRouter = TrpcRouterOf<App>`. */
  readonly declaration: string;
}
