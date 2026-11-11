import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scanModuleDirectory } from '@keelwerk/core/manifest';
import { describe, expect, test } from 'vitest';
import { useNewWorkspace } from './support/new-workspace.ts';

const workspace = useNewWorkspace();
const { runNew, listing, snapshot, read, libraryCopy } = workspace;

describe('parts in a copy of the library fixture', () => {
  test('every kind creates its file where the reference puts it and edits no existing file', async () => {
    const library = await libraryCopy();
    const before = await snapshot(library);
    const runs: [string[], string[]][] = [
      [['entity', 'library.reader'], ['src/entities/reader.ts']],
      [
        ['action', 'library.borrow'],
        ['src/actions/borrow.ts', 'src/actions/borrow.test.ts'],
      ],
      [['action', 'library.list-books', '--kind', 'query'], ['src/actions/list-books.ts']],
      [['action', 'library.reader.register'], ['src/actions/reader/register.ts']],
      [['rule', 'library.borrow.signed-in'], ['src/policies/borrow/signed-in.ts']],
      [
        ['rule', 'library.book.no-reading', '--effect', 'deny'],
        ['src/policies/book/no-reading.ts'],
      ],
      [['flag', 'library.trialFlow', '--expires', '2027-01-31'], ['src/flags/trial-flow.ts']],
      [['error', 'library.not-available'], ['src/errors/not-available.ts']],
      [['service', 'library.find-title'], ['src/services/find-title.ts']],
      [
        ['reaction', 'library.on-book', '--on', 'library.book.created'],
        ['src/reactions/on-book.ts', 'src/reactions/on-book.test.ts'],
      ],
      [['contribution', 'library.to-accounts'], ['src/contributions/to-accounts/contribution.ts']],
      [['condition', 'library.when-accounts'], ['src/conditional/when-accounts/condition.ts']],
      [['lib', 'library.add-days'], ['src/lib/add-days.ts']],
      [['shape', 'library.loan-window'], ['src/shapes/loan-window.ts']],
      [['effect', 'library.send-notice'], ['src/effects/send-notice.ts']],
      [['executor', 'library.send-notice'], ['src/executors/send-notice.ts']],
      [['schedule', 'library.borrow', '--every', '5m'], ['src/schedules/borrow.ts']],
      [
        ['action', 'accounts.profile.lookup', '--kind', 'query', '--from', 'library'],
        ['src/contributions/to-accounts/actions/profile/lookup.ts'],
      ],
      [
        ['rule', 'accounts.profile.visible', '--from', 'library'],
        ['src/contributions/to-accounts/policies/profile/visible.ts'],
      ],
      [
        ['action', 'library.sync', '--when', 'accounts'],
        ['src/conditional/when-accounts/actions/sync.ts'],
      ],
    ];
    for (const [argv, created] of runs) {
      const run = await runNew(...argv, '--dir', 'modules/library');
      expect(run.stderr, argv.join(' ')).toBe('');
      expect(run.code, argv.join(' ')).toBe(0);
      for (const path of created) {
        expect(await listing(library), `${argv.join(' ')} creates ${path}`).toContain(path);
      }
    }
    const after = await snapshot(library);
    for (const [path, text] of before) {
      expect(after.get(path), `${path} is unchanged`).toBe(text);
    }
    const scanned = scanModuleDirectory(
      [...after.keys()].filter((path) => path.startsWith('src/')).map((path) => path.slice(4)),
    );
    expect(scanned.unplaced).toEqual([]);
    const mounted = scanned.parts.map((part) => part.path);
    expect(mounted).toContain('./actions/reader/register.ts');
    expect(mounted).toContain('./policies/book/no-reading.ts');
    expect(mounted).toContain('./schedules/borrow.ts');
    expect(mounted).toContain('./contributions/to-accounts/actions/profile/lookup.ts');
    expect(mounted).toContain('./conditional/when-accounts/actions/sync.ts');
  });

  test('a reaction runs inline in M1', async () => {
    await libraryCopy();
    await runNew('reaction', 'library.on-book', '--on', 'library.book.created');
    expect(await read('modules/library/src/reactions/on-book.ts')).toContain("timing: 'inline',");
  });

  test('--from and --when write different targets for a rule', async () => {
    await libraryCopy();
    await runNew('condition', 'library.when-accounts', '--dir', 'modules/library');
    await runNew('action', 'library.sync', '--when', 'accounts', '--dir', 'modules/library');
    await runNew('rule', 'library.sync.open', '--when', 'accounts', '--dir', 'modules/library');
    const when = await read('modules/library/src/conditional/when-accounts/policies/sync/open.ts');
    expect(when).toContain("from '../../actions/sync.ts'");
    expect(when).toContain('defineRule(within(libraryBase, whenAccounts), sync, {');
    expect(when).not.toContain("actions: ['read']");
    await runNew('contribution', 'library.to-accounts', '--dir', 'modules/library');
    await runNew('rule', 'accounts.profile.visible', '--from', 'library');
    const from = await read(
      'modules/library/src/contributions/to-accounts/policies/profile/visible.ts',
    );
    expect(from).toContain("'profile'");
    expect(from).toContain("actions: ['read']");
  });

  test('the base hand edit of a condition prints the module import', async () => {
    await libraryCopy();
    const run = await runNew('condition', 'library.when-accounts', '--dir', 'modules/library');
    expect(run.stdout).toContain("import { accounts } from '@acme/module-accounts';");
  });

  test('what only a hand-written file can hold is printed, not written', async () => {
    await libraryCopy();
    const entity = await runNew('entity', 'library.reader', '--dir', 'modules/library');
    expect(entity.stdout).toContain("import { reader } from './entities/reader.ts';");
    expect(entity.stdout).toContain('entities: { reader },');
    const flag = await runNew(
      'flag',
      'library.trialFlow',
      '--expires',
      '2027-01-31',
      '--dir',
      'modules/library',
    );
    expect(flag.stdout).toContain('flags: { trialFlow },');
    const generated = await read('modules/library/src/flags/trial-flow.ts');
    expect(generated).toContain("kind: 'boolean'");
    expect(generated).toContain("expires: '2027-01-31'");
    expect(await read('modules/library/src/base.ts')).not.toContain('trialFlow');
  });

  test('a file that exists is never overwritten', async () => {
    await libraryCopy();
    expect((await runNew('shape', 'library.window', '--dir', 'modules/library')).code).toBe(0);
    await writeFile(join(workspace.root(), 'modules/library/src/shapes/window.ts'), 'edited\n');
    const again = await runNew('shape', 'library.window', '--dir', 'modules/library');
    expect(again.code).toBe(2);
    expect(again.stderr).toContain('already exists');
    expect(await read('modules/library/src/shapes/window.ts')).toBe('edited\n');
  });

  test('refusals name what to do first', async () => {
    await libraryCopy();
    const flag = await runNew('flag', 'library.beta', '--dir', 'modules/library');
    expect(flag.stderr).toContain('--expires');
    const executor = await runNew('executor', 'library.send-notice', '--dir', 'modules/library');
    expect(executor.stderr).toContain('keelwerk new effect library.send-notice');
    const scoped = await runNew(
      'action',
      'library.sync',
      '--when',
      'accounts',
      '--dir',
      'modules/library',
    );
    expect(scoped.stderr).toContain('keelwerk new condition library.when-accounts');
    const reaction = await runNew('reaction', 'library.on-book', '--dir', 'modules/library');
    expect(reaction.stderr).toContain('--on');
    const missing = await runNew('entity', 'nothing.reader');
    expect(missing.stderr).toContain('No module "nothing" found');
  });

  test('the reference of the module is found without --dir', async () => {
    await libraryCopy();
    const run = await runNew('lib', 'library.add-days');
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('create modules/library/src/lib/add-days.ts');
  });
});

describe('app and script', () => {
  test('app writes apps/<id> with the selection of modules', async () => {
    const run = await runNew('app', 'portal', '--modules', 'accounts,auth', '--scope', '@acme');
    expect(run.code).toBe(0);
    expect(await read('apps/portal/src/modules.ts')).toContain(
      'export const modules = [accounts, auth] as const;',
    );
    expect(await read('apps/portal/src/app.ts')).toContain("defineApp({ id: 'portal', modules })");
  });

  test('script writes scripts/<name>.ts', async () => {
    const run = await runNew('script', 'backfill-books');
    expect(run.code).toBe(0);
    expect(await read('scripts/backfill-books.ts')).toContain('backfill-books');
    expect(run.stdout).toContain('"backfill-books": "node scripts/backfill-books.ts"');
  });
});
