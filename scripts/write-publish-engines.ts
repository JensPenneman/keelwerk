// Writes `"engines": { "node": ">=26" }` into the package.json of every publishable package of
// packages/ (decision S-116). The committed manifests carry no `engines` field while the
// dependency updater runs Node 24; the release script runs this just before publishing and
// restores the manifests afterwards, so the field is in the tarballs and never in a commit.
//
//   node scripts/write-publish-engines.ts          rewrite the manifests in place
//   node scripts/write-publish-engines.ts --check  rewrite copies in a temporary directory and
//                                                  verify the result; touches no manifest
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const engines = { node: '>=26' };

/** The manifest files of the publishable packages under `root`/packages. */
function publishableManifests(root: string): string[] {
  const manifests: string[] = [];
  for (const entry of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(root, 'packages', entry.name, 'package.json');
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as { private?: boolean };
    if (manifest.private !== true) manifests.push(file);
  }
  return manifests;
}

/** Rewrites each manifest with the engines field; returns the package names. */
function writeEngines(files: readonly string[]): string[] {
  return files.map((file) => {
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as { name: string };
    writeFileSync(file, `${JSON.stringify({ ...manifest, engines }, null, 2)}\n`);
    return manifest.name;
  });
}

const root = fileURLToPath(new URL('..', import.meta.url));

if (!process.argv.includes('--check')) {
  const names = writeEngines(publishableManifests(root));
  process.stdout.write(`engines written into ${names.length} manifests: ${names.join(', ')}\n`);
} else {
  const committed = publishableManifests(root);
  const before = committed.map((file) => readFileSync(file, 'utf8'));
  const scratch = mkdtempSync(join(tmpdir(), 'keelwerk-engines-'));
  try {
    for (const file of committed) {
      const name = file.slice(root.length);
      cpSync(file, join(scratch, name), { recursive: true, force: true });
    }
    const copies = committed.map((file) => join(scratch, file.slice(root.length)));
    writeEngines(copies);
    const missing = copies.filter((file) => {
      const manifest = JSON.parse(readFileSync(file, 'utf8')) as { engines?: { node?: string } };
      return manifest.engines?.node !== engines.node;
    });
    if (missing.length > 0) throw new Error(`engines missing after the rewrite: ${missing.join()}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const touched = committed.filter((file, at) => readFileSync(file, 'utf8') !== before[at]);
  if (touched.length > 0)
    throw new Error(`the check changed committed manifests: ${touched.join()}`);
  process.stdout.write(`engines rewrite verified on ${committed.length} publishable manifests\n`);
}
