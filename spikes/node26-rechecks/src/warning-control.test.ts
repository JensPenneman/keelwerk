import { expect, test } from 'vitest';
import { runNode } from './run-node.ts';

test('a child process prints an emitted ExperimentalWarning, so the empty-stderr assertions can fail', () => {
  const run = runNode(['--eval', "process.emitWarning('probe', 'ExperimentalWarning')"]);
  expect(run.stderr).toContain('ExperimentalWarning');
});
