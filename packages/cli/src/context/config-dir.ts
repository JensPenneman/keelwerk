import type { CliHost } from './cli-host.ts';

/** `$XDG_CONFIG_HOME/keelwerk`, default `~/.config/keelwerk`: profiles and credentials. */
export function configDir(host: CliHost): string {
  const base = host.env.XDG_CONFIG_HOME;
  return `${base !== undefined && base !== '' ? base : `${host.homeDir}/.config`}/keelwerk`;
}
