/** The exit code Stricli left on the process object; its negative codes (unknown command, bad argument) are usage errors, 2. */
export function exitCodeOf(code: number | string | null | undefined): number {
  const number = typeof code === 'string' ? Number(code) : (code ?? 0);
  return number < 0 ? 2 : number;
}
