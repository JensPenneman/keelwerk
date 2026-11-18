import { describe, expect, it } from 'vitest';
import { jobKeyDigest } from './job-key-digest.ts';

const secret = new Uint8Array(32).fill(7);

describe('the digest of a job key part', () => {
  // WP-130: the job key digest binds its owner. The format of a stored job key part is
  // HMAC-SHA-256 under the job key secret over the length-prefixed owner and part; the vectors
  // were computed outside the kernel with node:crypto.
  it('is final: golden digests', () => {
    expect(jobKeyDigest(secret, 'billing', 'remind:a@b.c')).toBe(
      '63a06f3440c1a0f89de221a0bf86523425a18629fc799ec7a15c6061c69e4e75',
    );
    expect(jobKeyDigest(secret, 'a', 'b:c')).toBe(
      'fe342c3bb18121109cf7b40aaa979b85be317fcc97f99523d46ce4260d776403',
    );
  });

  it('gives two secrets two digests of one part', () => {
    expect(jobKeyDigest(new Uint8Array(32).fill(8), 'billing', 'remind:a@b.c')).not.toBe(
      jobKeyDigest(secret, 'billing', 'remind:a@b.c'),
    );
  });

  it('two owners give two digests of one part', () => {
    expect(jobKeyDigest(secret, 'mailer', 'remind:a@b.c')).not.toBe(
      jobKeyDigest(secret, 'billing', 'remind:a@b.c'),
    );
  });

  it('an owner and a part that concatenate alike give two digests', () => {
    expect(jobKeyDigest(secret, 'a', 'b:c')).not.toBe(jobKeyDigest(secret, 'a:b', 'c'));
    expect(jobKeyDigest(secret, 'a:b', 'c')).toBe(
      'ae6868b979f0c13823c29d20d9c576dd48965a60afcddfee9afedfda1cce5be4',
    );
  });

  it('has no colon and never holds the part', () => {
    const digest = jobKeyDigest(secret, 'billing', 'remind:a@b.c');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(':');
  });
});
