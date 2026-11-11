import type { ApiSurface, SurfaceAction } from '@keelwerk/core';
import { requiredIfVersion } from '@keelwerk/core';
import { commonFlags } from '../routes/common-flags.ts';
import { flagTable } from '../routes/flag-table.ts';
import type { CliManifestCommand } from './cli-manifest-command.ts';
import type { CliManifestFlag } from './cli-manifest-flag.ts';
import { cliManifestFormat } from './cli-manifest-format.ts';

function describe(node: { readonly description?: string }): { readonly description?: string } {
  return node.description === undefined ? {} : { description: node.description };
}

function positionalsOf(action: SurfaceAction): readonly CliManifestFlag[] {
  const fields = action.input.kind === 'shape' ? action.input.fields : {};
  const names = [...(action.instance ? ['id'] : []), ...(action.hints.cli?.positional ?? [])];
  return names.flatMap((name) => {
    const node = fields[name];
    return node === undefined
      ? []
      : [{ name, kind: node.kind, required: false, ...describe(node) }];
  });
}

function ifVersionFlagOf(action: SurfaceAction): readonly CliManifestFlag[] {
  const node = requiredIfVersion(action);
  return node === undefined
    ? []
    : [{ name: 'if-version', kind: node.kind, required: true, ...describe(node) }];
}

function commandOf(action: SurfaceAction): CliManifestCommand {
  const hint = action.hints.cli;
  const aliases = [
    ...(hint?.route !== undefined && hint.route.length > 0 ? [hint.route.join('.')] : []),
    ...(hint?.aliases ?? []),
  ].filter((alias) => alias !== action.ref);
  return {
    ref: action.ref,
    route: `call ${action.ref}`,
    aliases: [...new Set(aliases)].toSorted(),
    kind: action.kind,
    auth: action.auth,
    scope: action.scope,
    ...describe(action),
    positionals: positionalsOf(action),
    flags: [
      ...flagTable(action).map((entry) => ({
        name: entry.key,
        kind: entry.role === 'negate' ? 'boolean' : entry.node.kind,
        required: entry.role === 'value' && entry.node.optional !== true,
        ...(entry.role === 'negate' ? {} : describe(entry.node)),
      })),
      ...ifVersionFlagOf(action),
    ],
  };
}

/** The CLI manifest of a surface: a document value, not yet text (`renderCliManifest` writes it). */
export function cliManifestOf(surface: ApiSurface): {
  readonly format: typeof cliManifestFormat;
  readonly app: string;
  readonly apiVersion: string;
  readonly surface: string;
  readonly commonFlags: readonly string[];
  readonly commands: readonly CliManifestCommand[];
} {
  return {
    format: cliManifestFormat,
    app: surface.app,
    apiVersion: surface.apiVersion,
    surface: surface.hash,
    commonFlags: Object.keys(commonFlags()).toSorted(),
    commands: surface.actions.map(commandOf),
  };
}
