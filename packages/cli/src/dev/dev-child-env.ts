/** The environment of the app child: the machine's, with the explain stream on and the development environment named. */
export function devChildEnv(
  env: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> {
  return {
    ...env,
    ...Object.fromEntries([
      ['NODE_ENV', 'development'],
      ['KEELWERK_EXPLAIN', '1'],
    ]),
  };
}
