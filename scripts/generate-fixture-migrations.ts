// Writes the committed migration files of the library fixture module (architecture 14.6.4) over
// the planner of `@keelwerk/data`: migrations/own/snapshot.json and migrations/own/0001-initial.ts.
// With --check it says whether the committed files are what the definitions plan. WP-59 replaces
// it with `keelwerk db generate`.
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import type { EntityEntry, TrackSnapshot } from '../packages/core/src/index.ts';

const SOURCE_CONDITION = '--conditions=@keelwerk/source';
const here = fileURLToPath(import.meta.url);
const root = join(dirname(here), '..');

// The app imports `@keelwerk/core` by name: Node resolves it to the sources under this condition.
if (!process.execArgv.includes(SOURCE_CONDITION)) {
  const child = spawnSync(
    process.execPath,
    [SOURCE_CONDITION, ...process.execArgv, here, ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(child.status ?? 1);
}

const { buildTrackSnapshot } = await import(
  '../packages/data/src/migrations/build-track-snapshot.ts'
);
const { planTrack } = await import('../packages/data/src/migrations/plan-track.ts');
const { renderMigrationFile } = await import(
  '../packages/data/src/migrations/render-migration-file.ts'
);
const { renderSnapshot } = await import('../packages/data/src/migrations/render-snapshot.ts');
const { library } = await import('../packages/testing/src/fixtures/apps/library/src/app.ts');

const track = 'library';
const directory = join(root, 'packages/testing/src/fixtures/modules/library/migrations/own');

function trackOfField(entry: EntityEntry, field: string): string {
  return entry.fieldTracks?.[field] ?? entry.tracks[0]?.track ?? entry.module;
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as { readonly code?: string }).code === 'ENOENT') return null;
    throw error;
  }
}

const entries = [...library.registry.entities.values()];
const desired: TrackSnapshot | undefined = buildTrackSnapshot(entries, { trackOfField }).get(track);
if (desired === undefined) throw new Error(`the library app has no track ${track}`);

const check = process.argv.includes('--check');
// The script plans the whole track as its first file; later changes are `db generate`'s.
const plan = await planTrack({ previous: null, desired, name: 'initial', ask: async () => false });
if (plan === null) throw new Error('the library track plans no file');

const written = new Map<string, string>([
  ['snapshot.json', renderSnapshot(plan.snapshot)],
  ...plan.files.map((file) => [`${file.id}.ts`, renderMigrationFile(file)] as const),
]);
const drift: string[] = [];
for (const [name, text] of written) {
  const path = join(directory, name);
  if (check) {
    if ((await readOrNull(path)) !== text) drift.push(name);
  } else {
    await mkdir(directory, { recursive: true });
    await writeFile(path, text);
    process.stdout.write(`${path} written\n`);
  }
}
if (check && drift.length > 0) {
  process.stderr.write(`out of date: ${drift.join(', ')}\n`);
  process.exitCode = 1;
}
