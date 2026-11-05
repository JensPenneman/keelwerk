import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { KeelwerkError, parseApiVersionLedger, renderApiVersionLedger } from '@keelwerk/core';
import { writeModuleManifest } from '@keelwerk/core/manifest';
import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { usageFailure } from '../../context/usage-failure.ts';
import { deriveApps } from '../../producers/derive-apps.ts';
import { readIfPresent } from '../../producers/read-if-present.ts';
import { shownPath } from '../../producers/shown-path.ts';
import { handleFailure } from '../../routes/handle-failure.ts';
import { scopeOutput } from '../../routes/scope-output.ts';
import { findWorkspaceRoot } from '../doctor/find-workspace-root.ts';
import { changeFlag } from './change-flag.ts';
import { cutVersion } from './cut-version.ts';
import { surfaceFlags } from './surface-flags.ts';

function validDate(text: string): boolean {
  try {
    return Temporal.PlainDate.from(text, { overflow: 'reject' }).toString() === text;
  } catch {
    return false;
  }
}

/**
 * `surface version new <date> [--app <id>] [--change <id>]` (section 18.2): appends the new API
 * version to the ledger of each app with the module versions in force, the changes it adopts and
 * the surface hash, freezes the entry that was the head, and prints the line to add to
 * `defineApiVersions`; `generate --check` fails while the two disagree.
 */
export const versionNewCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [string],
  CliContext
>({
  docs: {
    brief: 'Cut a new API version in the ledger.',
    fullDescription:
      'surface version new 2027-01-12 --app portal   release the head entry and start 2027-01-12',
  },
  parameters: {
    flags: surfaceFlags(changeFlag),
    positional: {
      kind: 'tuple',
      parameters: [
        { brief: 'The new API version, YYYY-MM-DD.', parse: String, placeholder: 'date' },
      ],
    },
  } as never,
  async func(this: CliContext, parsed, date: string) {
    const scoped = scopeOutput(this, parsed);
    try {
      if (!validDate(date)) throw usageFailure(`"${date}" is not a YYYY-MM-DD calendar date.`);
      const root = await findWorkspaceRoot(scoped.host);
      const only = typeof parsed.app === 'string' ? parsed.app : undefined;
      const changes = ((parsed.change as readonly string[] | undefined) ?? []).flatMap((item) =>
        item.split(',').map((id) => id.trim()),
      );
      const derived = await deriveApps(root);
      const apps = derived.apps.filter((app) => only === undefined || app.app.id === only);
      if (apps.length === 0) {
        throw usageFailure(
          only === undefined ? 'The workspace has no app.' : `The workspace has no app "${only}".`,
        );
      }
      for (const app of apps) {
        const path = join(app.directory, 'generated', 'api-surface', app.app.id, 'ledger.json');
        const text = await readIfPresent(path);
        const implied = app.implied.at(-1);
        if (text === undefined || implied === undefined) {
          throw usageFailure(
            `${shownPath(root, path)} does not exist; run keelwerk generate first.`,
          );
        }
        const cut = cutVersion(parseApiVersionLedger(text), implied, date, changes);
        await mkdir(dirname(path), { recursive: true });
        await writeModuleManifest(path, renderApiVersionLedger(cut.ledger));
        scoped.output.line(`${shownPath(root, path)} written`);
        scoped.output.line(
          `add to defineApiVersions of ${app.app.id}: '${date}': ${changes.length === 0 ? '{}' : `{ changes: [${changes.join(', ')}] }`}`,
        );
      }
    } catch (failure) {
      handleFailure(
        scoped,
        failure instanceof KeelwerkError ? usageFailure(failure.message) : failure,
      );
    }
  },
});
