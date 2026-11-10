import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = readFileSync(join(repositoryRoot, '.github/workflows/release-please.yml'), 'utf8');

/** A job block: from `  <job>:` to the next two-space key. */
function job(name: string): string {
  const lines = workflow.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  expect(start).toBeGreaterThan(-1);
  const end = lines.findIndex((line, at) => at > start && /^ {2}\S/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

test('the publish job refuses forks and asks for id-token write', () => {
  const publish = job('publish');
  expect(publish).toContain("if: ${{ always() && github.repository == 'JensPenneman/keelwerk' }}");
  // The release job creates the tag this job looks for, so this job runs after it.
  expect(publish).toContain('needs: release-please');
  expect(publish).toContain('id-token: write');
  expect(publish).toContain('contents: read');
});

test('release-please runs only on main of the repository', () => {
  expect(job('release-please')).toContain(
    "if: github.repository == 'JensPenneman/keelwerk' && github.ref == 'refs/heads/main'",
  );
});

test('the dispatch input dry-run defaults to true', () => {
  expect(workflow).toMatch(
    /workflow_dispatch:\n {4}inputs:\n {6}dry-run:\n(?: {8}.+\n)*? {8}default: true\n/,
  );
});

test('push triggers only main', () => {
  expect(workflow).toMatch(/\n {2}push:\n {4}branches: \[main\]\n/);
});

test('every action is pinned to a full commit sha', () => {
  const uses = [...workflow.matchAll(/^\s*uses: (\S+)/gm)].map((match) => match[1] ?? '');
  expect(uses.length).toBeGreaterThan(0);
  for (const use of uses) expect(use).toMatch(/@[0-9a-f]{40}$/);
});

test('the publish step runs release.sh with the flag of the release step', () => {
  const publish = job('publish');
  const step = publish.slice(
    publish.indexOf('- name: Stage every package of the version (or dry-run them)'),
  );
  expect(step).toMatch(/NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/);
  expect(step).toMatch(/RELEASE_FLAG: \$\{\{ steps\.release\.outputs\.flag \}\}/);
  expect(step).toContain('run: bash scripts/release.sh "$RELEASE_FLAG"');
  expect(publish).toContain('- name: npm with stage commands');
  expect(publish).toContain('npm install -g npm@11.21.1');
  expect(publish).not.toContain('sort -V');
});

test('every step after the release check waits for the release', () => {
  const publish = job('publish');
  const steps = publish.split('\n      - name: ').slice(1);
  expect(steps).toHaveLength(7);
  for (const step of steps.slice(2)) {
    expect(step).toContain("if: steps.release.outputs.run == 'true'");
  }
});
