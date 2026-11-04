import { describe, expect, test } from 'vitest';
import { createFakeHost } from './support/fake-host.ts';
import { json, portalServer } from './support/portal-server.ts';
import { remoteProfileFiles } from './support/profile-files.ts';
import { runCliWith } from './support/run-cli-with.ts';

const page = {
  items: [
    { id: 'prof_a', name: 'Ada', nested: { a: 1 } },
    { id: 'prof_b', name: 'Bob', nested: { a: 2 } },
  ],
  pageInfo: { hasNext: false },
};

function host(interactive = false) {
  return createFakeHost({
    interactive,
    files: remoteProfileFiles,
    handler: portalServer({ invoke: () => json({ ok: true, value: page }) }),
  });
}

describe('output formats', () => {
  test('the default is JSON when standard output is not a terminal', async () => {
    const run = await runCliWith(['call', 'accounts.profile.query'], host().host);
    expect(JSON.parse(run.stdout)).toEqual(page);
  });

  test('the default on a terminal is text: a page prints as a table with the id first', async () => {
    const run = await runCliWith(['call', 'accounts.profile.query'], host(true).host);
    expect(run.stdout).toBe('ID      NAME\nprof_a  Ada\nprof_b  Bob\n');
  });

  test('--fields chooses the columns', async () => {
    const run = await runCliWith(
      ['call', 'accounts.profile.query', '--output', 'table', '--fields', 'name'],
      host().host,
    );
    expect(run.stdout).toBe('NAME\nAda\nBob\n');
  });

  test('yaml uses the yaml package', async () => {
    const run = await runCliWith(
      ['call', 'accounts.profile.query', '--output', 'yaml'],
      host().host,
    );
    expect(run.stdout).toContain('items:\n  - id: prof_a\n    name: Ada');
  });

  test('ndjson prints one row per line', async () => {
    const run = await runCliWith(
      ['call', 'accounts.profile.query', '--output', 'ndjson'],
      host().host,
    );
    expect(
      run.stdout
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line)),
    ).toEqual(page.items);
  });

  test('a row prints as a key-value block', async () => {
    const fake = createFakeHost({
      interactive: true,
      files: remoteProfileFiles,
      handler: portalServer({
        invoke: () => json({ ok: true, value: { id: 'prof_a', name: 'Ada' } }),
      }),
    });
    const run = await runCliWith(['call', 'accounts.profile.query'], fake.host);
    expect(run.stdout).toBe('id:   prof_a\nname: Ada\n');
  });
});
