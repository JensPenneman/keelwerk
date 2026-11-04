/** One file a scaffold creates; `path` is relative to the working directory, with `/` separators. */
export interface ScaffoldFile {
  readonly path: string;
  readonly text: string;
}
