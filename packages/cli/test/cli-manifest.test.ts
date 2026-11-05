import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { renderCliManifest } from '../src/manifest/render-cli-manifest.ts';
import { portalSurface } from './support/portal-surface.ts';

const golden = fileURLToPath(new URL('./generated/cli-manifest.json', import.meta.url));

test('the CLI manifest of the portal surface is pinned by its golden', async () => {
  const text = renderCliManifest(portalSurface);
  expect(text).toBe(await readFile(golden, 'utf8'));
});

test('the manifest names routes, positionals and flags, and renders the same bytes twice', () => {
  const text = renderCliManifest(portalSurface);
  expect(renderCliManifest(portalSurface)).toBe(text);
  expect(text.endsWith('}\n')).toBe(true);
  const manifest = JSON.parse(text) as {
    format: string;
    app: string;
    apiVersion: string;
    commands: { ref: string; route: string; flags: { name: string }[] }[];
  };
  expect(manifest).toMatchObject({
    format: 'keelwerk.cli/1',
    app: portalSurface.app,
    apiVersion: portalSurface.apiVersion,
  });
  expect(manifest.commands).toHaveLength(portalSurface.actions.length);
  const create = manifest.commands.find((command) => command.ref === 'accounts.profile.create');
  expect(create?.route).toBe('call accounts.profile.create');
  expect(create?.flags.map((flag) => flag.name)).toContain('owner');
});
