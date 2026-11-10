import { expect, test } from 'vitest';
import type { PublishRow } from '../publish-row.ts';
import { releaseSummary, stoppedSummary } from '../release-summary.ts';

const id = '11111111-2222-3333-4444-555555555555';
const rows: readonly PublishRow[] = [
  { name: '@x/a', version: '0.1.0', outcome: 'staged', stageId: id },
  { name: '@x/b', version: '0.1.0', outcome: 'already published' },
  { name: '@x/c', version: '0.1.0', outcome: 'failed', detail: 'E403 forbidden' },
  { name: '@x/d', version: '0.1.0', outcome: 'not attempted' },
];

test('lists every package with its outcome and provenance, in order', () => {
  const text = releaseSummary({ version: '0.1.0', mode: 'staged', dryRun: false, rows });
  expect(text).toContain('## keelwerk 0.1.0: staged\n');
  expect(text).toContain('| Package | Version | Provenance | Outcome | Stage id |');
  expect(text).toContain(`| @x/a | 0.1.0 | on | staged | ${id} |`);
  expect(text).toContain('| @x/c | 0.1.0 | on | failed: E403 forbidden |  |');
  expect(text.indexOf('@x/a |')).toBeLessThan(text.indexOf('@x/b |'));
  expect(text.indexOf('@x/c |')).toBeLessThan(text.indexOf('@x/d |'));
});

test('staged rows give the stage ids in order, the website batch and the audit line', () => {
  const text = releaseSummary({
    version: '0.1.0',
    mode: 'trusted',
    dryRun: false,
    rows: [...rows, { name: '@x/e', version: '0.1.0', outcome: 'already staged' }],
  });
  expect(text).toContain('Staged Packages page in one batch');
  expect(text).toContain(`- @x/a: ${id}`);
  expect(text).toContain('- @x/e: npm stage list @x/e');
  expect(text).toContain(
    'After approval: npm audit signatures in a fresh project that pins every package at 0.1.0.',
  );
});

test('a dry run says so in the heading and lists no approval', () => {
  const text = releaseSummary({
    version: '0.1.0',
    mode: 'staged',
    dryRun: true,
    rows: [{ name: '@x/a', version: '0.1.0', outcome: 'dry run' }],
  });
  expect(text).toContain('## keelwerk 0.1.0: staged, dry run');
  expect(text).not.toContain('Staged Packages page');
});

test('a stopped run says why and lists every package as not attempted', () => {
  const text = stoppedSummary({
    version: '0.1.0',
    mode: 'trusted',
    dryRun: false,
    message: 'refused: nothing',
    names: ['@x/a', '@x/b'],
  });
  expect(text).toContain('## keelwerk 0.1.0: trusted\n');
  expect(text).toContain('stopped before anything was staged: refused: nothing');
  expect(text).toContain('| @x/a | not attempted |');
  expect(text).toContain('| @x/b | not attempted |');
});
