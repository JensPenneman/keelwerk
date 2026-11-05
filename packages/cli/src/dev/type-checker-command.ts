/** The type checker's program and arguments (section 13.6): `tsc -b --watch --preserveWatchOutput`. */
export interface TypeCheckerCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export const typeCheckerCommand: TypeCheckerCommand = {
  command: 'pnpm',
  args: ['exec', 'tsc', '-b', '--watch', '--preserveWatchOutput'],
};
