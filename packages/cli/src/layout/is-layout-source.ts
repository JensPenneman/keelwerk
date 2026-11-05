/** A `.ts` file that holds a definition: not a test, a type test, a declaration file or a generated artefact. */
export function isLayoutSource(path: string): boolean {
  return (
    path.endsWith('.ts') &&
    !/\.(test|test-d|d|generated)\.ts$/.test(path) &&
    !path.endsWith('/keelwerk.generated.ts')
  );
}
