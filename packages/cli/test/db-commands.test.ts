import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { renameAsk } from '../src/db/rename-ask.ts';
import { createFakeHost } from './support/fake-host.ts';
import { useScratchProject } from './support/scratch-project.ts';
import { shopSources } from './support/shop-project.ts';

const migrations = 'packages/module-shop/migrations/own';

describe('db generate, plan and check', () => {
  const newProject = useScratchProject();

  test('the first file is written for the module, the manifest starts shipping migrations, and every check passes', async () => {
    const project = await newProject();
    await project.write(shopSources('total'));
    expect((await project.run('generate')).code).toBe(0);
    expect((await project.run('generate', '--check')).stderr).toBe('');

    const plan = await project.run('db', 'plan', 'shop', '--output', 'text');
    expect(plan.code).toBe(0);
    expect(plan.stdout).toContain('shop 0001-next');
    expect(plan.stdout).toContain('create table "demo"."shop__order"');

    const missingName = await project.run('db', 'generate', 'shop');
    expect(missingName.code).toBe(2);
    expect((await project.run('db', 'generate', 'nope', '--name', 'x')).code).toBe(2);

    const generated = await project.run('db', 'generate', 'shop', '--name', 'initial');
    expect(generated.code).toBe(0);
    expect(generated.stdout).toContain(`${migrations}/0001-initial.ts`);
    expect(generated.stdout).toContain('it now ships migrations');
    expect((await readdir(join(project.root, migrations))).toSorted()).toEqual([
      '0001-initial.ts',
      'snapshot.json',
    ]);
    expect(
      await readFile(join(project.root, 'packages/module-shop/src/module.generated.ts'), 'utf8'),
    ).toContain('migrations: new URL');

    const again = await project.run(
      'db',
      'generate',
      'shop',
      '--name',
      'initial',
      '--output',
      'text',
    );
    expect(again.stdout).toContain('shop is up to date');
    expect((await project.run('generate', '--check')).code).toBe(0);

    const checked = await project.run('db', 'check', '--output', 'text');
    expect(checked.code).toBe(0);
    expect(checked.stdout).toContain('demo: shop match their snapshots');
  }, 120_000);

  test('changed definitions fail generate --check until db generate writes the next file; a rename answered by flag is recorded', async () => {
    const first = await newProject();
    await first.write(shopSources('total'));
    await first.run('generate');
    await first.run('db', 'generate', 'shop', '--name', 'initial');
    const project = await first.fork();
    await project.write(shopSources('amount'));

    const stale = await project.run('generate', '--check');
    expect(stale.code).toBe(1);
    expect(stale.stderr).toContain('run keelwerk db generate shop --name <name>');

    const renamed = await project.run(
      'db',
      'generate',
      'shop',
      '--name',
      'rename-total',
      '--rename',
      'shop.order.total=amount',
    );
    expect(renamed.code).toBe(0);
    expect(renamed.stdout).toContain('0002-rename-total.ts');
    const expand = await readFile(join(project.root, migrations, '0002-rename-total.ts'), 'utf8');
    expect(expand).toContain("from: 'total'");
    expect(expand).toContain("to: 'amount'");
    const contract = await readFile(
      join(project.root, migrations, '0003-rename-total-contract.ts'),
      'utf8',
    );
    expect(contract).toContain("op: 'copyColumn'");
    expect(contract).toContain("op: 'dropColumn'");
    await project.run('generate');
    expect((await project.run('generate', '--check')).code).toBe(0);
  }, 120_000);

  test('the planner asks and the answer decides: a drop and an add without it', async () => {
    const answer = async (stdinInteractive: boolean, line: string, accepted: string[] = []) =>
      renameAsk(
        createFakeHost({ stdinInteractive, line }).host,
        accepted,
      )({
        entity: 'shop.order',
        from: 'total',
        to: 'amount',
      });
    expect(await answer(false, '', ['shop.order.total=amount'])).toBe(true);
    expect(await answer(false, 'y')).toBe(false);
    expect(await answer(true, 'y')).toBe(true);
    expect(await answer(true, 'n')).toBe(false);
  });
});
