/** Where a file of a module's `src/` sits, in the terms of sections 23.2 and 23.6. */
export interface FileLocation {
  /** The contribution or condition directory the file is inside. */
  readonly scope:
    | { readonly section: 'conditional' | 'contributions'; readonly dir: string }
    | undefined;
  /** The first directory below `src/` (or below the scope directory): `actions`, `entities`, ... undefined for a file directly in `src/` or in a scope directory. */
  readonly directory: string | undefined;
  /** The subdirectory a part sits in (`actions/credential/revoke.ts` has `credential`); undefined when the file is deeper or not in one. */
  readonly owner: string | undefined;
  /** The file name without `.ts`. */
  readonly name: string;
  /** The directories between `src/` (or the scope) and the file, outermost first. */
  readonly folders: readonly string[];
}

/** Splits a path relative to `src/` into the parts the layout checks compare. */
export function locateFile(path: string): FileLocation {
  const segments = path.split('/');
  const name = (segments.at(-1) ?? '').replace(/\.ts$/, '');
  const [first, second, ...rest] = segments.slice(0, -1);
  const section = first === 'contributions' || first === 'conditional' ? first : undefined;
  const scope: FileLocation['scope'] =
    section !== undefined && second !== undefined ? { section, dir: second } : undefined;
  const folders = scope === undefined ? segments.slice(0, -1) : rest;
  return {
    scope,
    directory: folders[0],
    owner: folders.length === 2 ? folders[1] : undefined,
    name,
    folders,
  };
}
