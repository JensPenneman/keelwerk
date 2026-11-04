/** The directory name of a sibling module package: `module-<id>` below `packages/`, the id below `modules/`. */
export function packageDirectory(id: string, packagesLayout: boolean): string {
  return packagesLayout ? `module-${id}` : id;
}
