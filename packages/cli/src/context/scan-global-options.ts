import type { GlobalOptions } from './global-options.ts';

const names = ['profile', 'backend', 'tenant', 'socket', 'config'] as const;

/** Reads `--profile`, `--backend`, `--tenant`, `--socket` and `--config` (also as `--name=value`) from the arguments. */
export function scanGlobalOptions(argv: readonly string[]): GlobalOptions {
  const found: Partial<Record<(typeof names)[number], string>> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    if (argument === '--') {
      break;
    }
    for (const name of names) {
      if (argument === `--${name}`) {
        const next = argv[index + 1];
        if (next !== undefined) {
          found[name] = next;
          index += 1;
        }
      } else if (argument.startsWith(`--${name}=`)) {
        found[name] = argument.slice(name.length + 3);
      }
    }
  }
  return found;
}
