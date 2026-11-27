import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { workflowJob } from './support/workflow-job.ts';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pins = (
  JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8')) as {
    readonly pins: { readonly npm: string };
  }
).pins;
const workflow = readFileSync(join(repositoryRoot, '.github/workflows/release-please.yml'), 'utf8');

test('the publish job refuses forks and asks for id-token write', () => {
  const publish = workflowJob(workflow, 'publish');
  expect(publish).toContain("always() && github.repository == 'JensPenneman/keelwerk'");
  // The release job creates the tag this job looks for, so this job runs after it.
  expect(publish).toContain('needs: release-please');
  expect(publish).toContain('id-token: write');
  expect(publish).toContain('contents: read');
});

test('release-please runs only on main of the repository', () => {
  expect(workflowJob(workflow, 'release-please')).toContain(
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
  const publish = workflowJob(workflow, 'publish');
  const step = publish.slice(
    publish.indexOf('- name: Stage every package of the version (or dry-run them)'),
  );
  expect(step).toMatch(/NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/);
  expect(step).toMatch(/RELEASE_FLAG: \$\{\{ steps\.release\.outputs\.flag \}\}/);
  expect(step).toContain('run: bash scripts/release.sh "$RELEASE_FLAG"');
  expect(publish).toContain('- name: npm with stage commands');
  expect(publish).toContain(`npm install -g npm@${pins.npm}\n`);
  expect(publish).not.toContain('sort -V');
});

test('release.sh runs the command through its bin link before it checks and stages', () => {
  const script = readFileSync(join(repositoryRoot, 'scripts/release.sh'), 'utf8');
  const link = script.indexOf('bash scripts/check-bin-link.sh "$1"');
  expect(link).toBeGreaterThan(0);
  expect(link).toBeLessThan(script.indexOf('node scripts/publish-packages.ts'));
});

test('every step after the release check waits for the release', () => {
  const publish = workflowJob(workflow, 'publish');
  const steps = publish.split('\n      - name: ').slice(1);
  expect(steps).toHaveLength(7);
  for (const step of steps.slice(2)) {
    expect(step).toContain("if: steps.release.outputs.run == 'true'");
  }
});
