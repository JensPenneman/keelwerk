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

test('a command whose input requires ifVersion lists --if-version as required; others do not', () => {
  const strict = portalSurface.actions.map((candidate) => {
    const input = candidate.input;
    if (candidate.ref !== 'accounts.profile.deactivate' || input.kind !== 'shape') {
      return candidate;
    }
    const version = input.fields.ifVersion;
    return version === undefined
      ? candidate
      : {
          ...candidate,
          input: {
            ...input,
            fields: { ...input.fields, ifVersion: { ...version, optional: false } },
          },
        };
  });
  const manifest = JSON.parse(renderCliManifest({ ...portalSurface, actions: strict })) as {
    commands: { ref: string; flags: { name: string; required: boolean }[] }[];
  };
  const flagsOf = (ref: string) => manifest.commands.find((command) => command.ref === ref)?.flags;
  expect(flagsOf('accounts.profile.deactivate')).toContainEqual(
    expect.objectContaining({ name: 'if-version', kind: 'integer', required: true }),
  );
  expect(flagsOf('accounts.profile.create')?.map((flag) => flag.name)).not.toContain('if-version');
});
