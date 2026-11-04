/**
 * Throws when a compiler output holds an error line whose code is not in `allowed`; the portability
 * codes are judged by the gate, every other error means the measured program is broken.
 */
export function throwOnCompileErrors(
  label: string,
  output: string,
  allowed: readonly string[],
): void {
  const errors = output.split('\n').filter((line) => {
    const code = /\berror (TS\d+):/.exec(line)?.[1];
    return code !== undefined && !allowed.includes(code);
  });
  if (errors.length > 0) {
    throw new Error(
      `${label} does not compile (${errors.length} errors):\n${errors.slice(0, 20).join('\n')}`,
    );
  }
}
