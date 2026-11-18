import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { useInitProjects } from './support/init-project.ts';
import { repository } from './support/repository.ts';

const makeProject = useInitProjects();

interface PackageJson {
  readonly packageManager?: string;
  readonly devDependencies: Record<string, string>;
}

async function readPackageJson(path: string): Promise<PackageJson> {
  return JSON.parse(await readFile(path, 'utf8')) as PackageJson;
}

const workspace = await readPackageJson(join(repository, 'package.json'));

describe('the versions the CLI writes follow the workspace', () => {
  test('a new project pins Biome, @types/node, knip, TypeScript and Vitest at the workspace versions', async () => {
    const project = await makeProject();
    const written = await readPackageJson(join(project.root, 'package.json'));
    for (const name of ['@biomejs/biome', '@types/node', 'knip', 'typescript', 'vitest']) {
      expect(written.devDependencies[name], name).toBe(workspace.devDependencies[name]);
    }
  });

  test('the starter module pins Vitest at the workspace version', async () => {
    const project = await makeProject();
    const written = await readPackageJson(
      join(project.root, 'modules', project.module, 'package.json'),
    );
    expect(written.devDependencies.vitest).toBe(workspace.devDependencies.vitest);
  });

  test('knip.json of a new project names the schema of the workspace knip', async () => {
    const project = await makeProject();
    const written = JSON.parse(await readFile(join(project.root, 'knip.json'), 'utf8')) as {
      readonly $schema: string;
    };
    expect(written.$schema).toBe(
      `https://unpkg.com/knip@${workspace.devDependencies.knip}/schema.json`,
    );
  });

  test("the compose file installs the packageManager pnpm on the portal's node image", async () => {
    const project = await makeProject();
    const written = await readFile(join(project.root, '.launchway', 'compose.yaml'), 'utf8');
    const portal = await readFile(
      join(repository, 'examples', 'portal', '.launchway', 'compose.yaml'),
      'utf8',
    );
    const pnpmVersion = (workspace.packageManager ?? '').replace(/^pnpm@/, '');
    const install = `npm install -g pnpm@${pnpmVersion} `;
    expect(written).toContain(install);
    expect(portal).toContain(install);
    const image = (text: string): string | undefined => /^\s*image: (\S+)$/m.exec(text)?.[1];
    expect(image(written)).toBe(image(portal));
    expect(image(portal)).toMatch(/^node:\d+\.\d+\.\d+-trixie$/);
  });
});
