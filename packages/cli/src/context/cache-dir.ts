import type { CliHost } from './cli-host.ts';

/** `$XDG_CACHE_HOME/keelwerk`, default `~/.cache/keelwerk`: cached surfaces. */
export function cacheDir(host: CliHost): string {
  const base = host.env.XDG_CACHE_HOME;
  return `${base !== undefined && base !== '' ? base : `${host.homeDir}/.cache`}/keelwerk`;
}
