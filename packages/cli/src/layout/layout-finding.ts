/** One drift the layout pass found, with the fix it names; the pass never applies it. */
export interface LayoutFinding {
  /** The four kinds of drift of section 23.13. */
  readonly kind: 'mounts' | 'names' | 'packages' | 'placement';
  /** The file or directory the finding is about, relative to the workspace root. */
  readonly path: string;
  readonly message: string;
  readonly fix: string;
}
