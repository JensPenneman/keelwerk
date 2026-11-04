/**
 * The track id of section 14.6.1: `auth` for the module's own track, `auth->accounts` for what it
 * contributes to `accounts`, and a bracketed list of `when` modules for the parts that need them
 * (`auth[accounts]`, `auth->projects[teams]`). The `when` modules are sorted, so two orders of one set
 * name one track.
 */
export function trackId(
  module: string,
  target: string | null = null,
  when: readonly string[] = [],
): string {
  const arrow = target === null || target === module ? '' : `->${target}`;
  const bracket = when.length === 0 ? '' : `[${[...when].sort().join(',')}]`;
  return `${module}${arrow}${bracket}`;
}
