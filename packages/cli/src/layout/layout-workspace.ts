import type { ParsedSource } from './parsed-source.ts';

/** A module root (S-13): `src/` holds the module, its package (when it is one) sits beside. */
export interface ModuleRoot {
  readonly dir: string;
  /** The directory that holds the module's parts: `<dir>/src`, or the directory itself for the core module (S-11). */
  readonly sourceDir: string;
  /** The literal `id` of `base.ts`; undefined when the base is missing or has none. */
  readonly id: string | undefined;
  /** A transport or listener module declared with sugar: it keeps a hand-written `src/module.ts`. */
  readonly sugar: boolean;
  /** Every file below `src/`, relative to it. */
  readonly files: readonly string[];
  /** The sources below `src/` that are neither tests nor declaration files, by path relative to `src/`. */
  readonly sources: ReadonlyMap<string, ParsedSource>;
  /** The generated manifest (or the hand-written `module.ts` of a sugar module), parsed. */
  readonly entry: ParsedSource | undefined;
  /** The directories directly below `migrations/`. */
  readonly tracks: readonly string[];
  readonly hasMigrations: boolean;
}

/** An app root: `src/app.ts` and the app-level parts beside it. */
export interface AppRoot {
  readonly dir: string;
  readonly files: readonly string[];
  readonly sources: ReadonlyMap<string, ParsedSource>;
}

/** A package of the workspace: its directory and its `package.json` and `tsconfig.json`, parsed. */
export interface WorkspacePackage {
  readonly dir: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly tsconfig: Readonly<Record<string, unknown>> | undefined;
}

/** What the layout pass reads of a workspace: every root it knows and the text it needs, read once. */
export interface LayoutWorkspace {
  readonly root: string;
  readonly files: readonly string[];
  readonly modules: readonly ModuleRoot[];
  readonly apps: readonly AppRoot[];
  readonly packages: readonly WorkspacePackage[];
  /** The root `tsconfig.json`, parsed. */
  readonly rootTsconfig: Readonly<Record<string, unknown>> | undefined;
}
