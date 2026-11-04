import { monitorEventLoopDelay } from 'node:perf_hooks';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import type { ComputePool } from '../kernel/compute-pool.ts';
import { argon2idHash } from './argon2id-hash.ts';
import { argon2idParams } from './argon2id-params.ts';
import { argon2idVerify } from './argon2id-verify.ts';
import { createComputePool } from './create-compute-pool.ts';
import { dummyVerifier } from './dummy-verifier.ts';
import { needsRehash } from './needs-rehash.ts';
import { parseArgon2idHash } from './parse-argon2id-hash.ts';

const salt = new Uint8Array(16).fill(7);
let pool: ComputePool | undefined;
afterEach(async () => {
  await pool?.close();
  pool = undefined;
});

describe('Argon2id', () => {
  it('writes a PHC string with its parameters and verifies it', () => {
    const phc = argon2idHash('correct horse', salt);
    expect(phc).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    expect(parseArgon2idHash(phc)?.params).toEqual(argon2idParams);
    expect(argon2idVerify(phc, 'correct horse')).toBe(true);
    expect(argon2idVerify(phc, 'wrong horse')).toBe(false);
    expect(argon2idVerify('not a hash', 'x')).toBe(false);
  });

  it('is final: golden hash', () => {
    expect(argon2idHash('correct horse', salt)).toBe(
      '$argon2id$v=19$m=19456,t=2,p=1$BwcHBwcHBwcHBwcHBwcHBw$cTLmpgKLeruU6za+t2cUZ3fNfHVCYhGoJ8inpcUNcwc',
    );
  });

  it('rejects a short salt and hostile parameters in a stored string', () => {
    expect(() => argon2idHash('x', new Uint8Array(8))).toThrow('at least 16 bytes');
    expect(
      parseArgon2idHash(
        '$argon2id$v=19$m=99999999,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAA',
      ),
    ).toBeUndefined();
  });

  it('flags hashes that need a rehash', () => {
    const weaker = argon2idHash('x', salt, { ...argon2idParams, passes: 1 });
    expect(needsRehash(weaker)).toBe(true);
    expect(needsRehash('garbage')).toBe(true);
    expect(needsRehash(dummyVerifier)).toBe(false);
    expect(needsRehash(argon2idHash('x', salt))).toBe(false);
  });

  it('has a dummy verifier no password opens, at the cost of a real one', () => {
    expect(parseArgon2idHash(dummyVerifier)?.params).toEqual(argon2idParams);
    expect(argon2idVerify(dummyVerifier, 'password')).toBe(false);
  });
});

describe('the computation pool', () => {
  it('hashes and verifies off the main thread, with the same result as the main thread', async () => {
    pool = createComputePool({ size: 2 });
    const phc = await pool.argon2idHash('correct horse', salt);
    expect(phc).toBe(argon2idHash('correct horse', salt));
    expect(await pool.argon2idVerify(phc, 'correct horse')).toBe(true);
    expect(await pool.argon2idVerify(phc, 'wrong')).toBe(false);
    expect(await pool.argon2idVerify('garbage', 'wrong')).toBe(false);
  });

  it('turns a failing computation into an internal error and stays usable', async () => {
    pool = createComputePool({ size: 1 });
    await expect(pool.argon2idHash('x', new Uint8Array(4))).rejects.toMatchObject({
      code: 'core.internal',
    });
    expect(await pool.argon2idVerify(dummyVerifier, 'x')).toBe(false);
  });

  it('keeps the event loop free during 32 concurrent verifications', {
    timeout: 60_000,
  }, async () => {
    pool = createComputePool({ size: 2 });
    await Promise.all([
      pool.argon2idVerify(dummyVerifier, 'warm up'),
      pool.argon2idVerify(dummyVerifier, 'warm up'),
    ]);
    // Wall-clock lag is also caused by other processes taking the core on a busy machine, so the
    // assertion counts the main thread's own cpu time between two turns of the loop: hashing on
    // the main thread would show as one burst of about a hundred milliseconds or more.
    const delay = monitorEventLoopDelay({ resolution: 1 });
    delay.enable();
    const cpuMs = (): number => {
      const cpu = process.threadCpuUsage();
      return (cpu.user + cpu.system) / 1000;
    };
    let longestBurstMs = 0;
    let last = cpuMs();
    let done = false;
    const sampler = (async () => {
      while (!done) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        const now = cpuMs();
        longestBurstMs = Math.max(longestBurstMs, now - last);
        last = now;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    })();
    const started = performance.now();
    const results = await Promise.all(
      Array.from({ length: 32 }, (_, i) => pool?.argon2idVerify(dummyVerifier, `password ${i}`)),
    );
    const elapsed = performance.now() - started;
    done = true;
    await sampler;
    delay.disable();
    expect(results.every((r) => r === false)).toBe(true);
    process.stdout.write(
      `32 verifications in ${elapsed.toFixed(0)} ms on 2 workers: longest main-thread cpu burst ${longestBurstMs.toFixed(2)} ms, wall-clock event-loop lag ${(delay.max / 1e6 - 1).toFixed(2)} ms\n`,
    );
    expect(longestBurstMs).toBeLessThan(5);
  });

  it('measures one hash', async () => {
    pool = createComputePool({ size: 1 });
    await pool.argon2idHash('warm', salt);
    const samples: number[] = [];
    for (let i = 0; i < 9; i++) {
      const t = performance.now();
      await pool.argon2idHash('correct horse', salt);
      samples.push(performance.now() - t);
    }
    samples.sort((a, b) => a - b);
    process.stdout.write(`argon2id via pool, median ${samples[4]?.toFixed(1)} ms per hash\n`);
    expect(samples[4]).toBeGreaterThan(0);
  });

  it('closes on stop: running work finishes, new work is refused', async () => {
    pool = createComputePool({ size: 1 });
    const running = pool.argon2idHash('x', salt);
    const queued = pool.argon2idHash('y', salt);
    const closed = pool.close();
    await expect(pool.argon2idHash('z', salt)).rejects.toMatchObject({ code: 'core.unavailable' });
    await closed;
    expect(await running).toMatch(/^\$argon2id/);
    expect(await queued).toMatch(/^\$argon2id/);
    await pool.close();
  });

  it('closes an idle pool and a pool that never started', async () => {
    await createComputePool().close();
    pool = createComputePool({ size: 1 });
    await pool.argon2idHash('x', salt);
    await pool.close();
  });
});
