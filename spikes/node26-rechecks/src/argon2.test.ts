import process from 'node:process';
import { expect, test } from 'vitest';
import { runNode } from './run-node.ts';

const script = `
  import { argon2, randomBytes } from 'node:crypto';
  import { promisify } from 'node:util';
  const hash = promisify(argon2);
  const nonce = randomBytes(16);
  const parameters = { message: 'correct horse battery staple', nonce, parallelism: 1, tagLength: 32, memory: 19456, passes: 2 };
  const samples = [];
  let tag;
  for (let i = 0; i < 21; i++) {
    const start = process.hrtime.bigint();
    tag = await hash('argon2id', parameters);
    samples.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  const again = await hash('argon2id', parameters);
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({ medianMs: samples[10], minMs: samples[0], maxMs: samples[20], tagLength: tag.length, deterministic: tag.equals(again) }));
`;

test('crypto.argon2 runs Argon2id at the OWASP minimum without a warning', () => {
  const run = runNode(['--input-type=module', '--eval', script]);
  expect(run.stderr).toBe('');
  expect(run.status).toBe(0);
  const out = JSON.parse(run.stdout) as {
    medianMs: number;
    minMs: number;
    maxMs: number;
    tagLength: number;
    deterministic: boolean;
  };
  expect(out.tagLength).toBe(32);
  expect(out.deterministic).toBe(true);
  // The median is recorded in REPORT.md, never asserted.
  process.stdout.write(
    `argon2id median ${out.medianMs.toFixed(2)} ms (min ${out.minMs.toFixed(2)}, max ${out.maxMs.toFixed(2)})\n`,
  );
});
