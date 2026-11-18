import { describe, expect, test } from 'vitest';
import { noteEvent, reactionOf, reactionRegistry } from '../../test/reaction-kit.ts';
import { reactionJobKey } from './reaction-job-key.ts';
import { reactionKeyValue } from './reaction-key-value.ts';

const registry = reactionRegistry();
const event = noteEvent();

const secret = new Uint8Array(32).fill(7);
const otherSecret = new Uint8Array(32).fill(8);

// Golden vectors of the stored format `<reaction id>:<HMAC-SHA-256 of the reaction id and the part
// under the job key secret>`: no part is in the clear. WP-130: regenerated, the digest is keyed and
// binds its owner (it was a plain sha256 of the part, which a holder of the dump could check a
// guess against); computed outside the kernel with node:crypto.
const hashOf = {
  tally: '5890a55691958f7e7eaa7d0975350b119672985d88ff977a9de3e35080db9e91',
  event: '3963bae9d4feb352cb904db4c9056e99376943d254ed38e566272fbdf35ab5ac',
  latest: '8b1960885da6c6b20a1477271f90105864c0912ade703686722073d855073d08',
  chan: 'c757ee61fc4b04d68fffa88b3a8fc3c516889ca280f09a3e0dac3063637b3992',
  stream: '72707341af5850e2da9518e1ef70ee30b749de51cb993bf31c106f0b66485678',
};

describe('the key of a reaction job', () => {
  test('golden: the reaction id, a colon and the keyed digest of the part', () => {
    expect(reactionKeyValue({ id: 'logs.tally' }, 'chan', secret)).toBe(
      `logs.tally:${hashOf.tally}`,
    );
  });

  test('a reaction without ordering keeps one job per event, whatever key it declares', () => {
    expect(reactionJobKey(reactionOf(registry, 'plain'), event, 'ignored', secret)).toEqual({
      value: `logs.plain:${hashOf.event}`,
      onConflict: 'keep',
    });
  });

  test('a coalescing reaction replaces the pending job of its key', () => {
    expect(reactionJobKey(reactionOf(registry, 'latest'), event, 'chan', secret)).toEqual({
      value: `logs.latest:${hashOf.latest}`,
      onConflict: 'replace',
    });
  });

  test('a FIFO reaction appends to the queue of its key, else of the event stream', () => {
    const ordered = reactionOf(registry, 'ordered');
    expect(reactionJobKey(ordered, event, 'chan', secret)).toEqual({
      value: `logs.ordered:${hashOf.chan}`,
      onConflict: 'append',
    });
    expect(reactionJobKey(ordered, event, undefined, secret)).toEqual({
      value: `logs.ordered:${hashOf.stream}`,
      onConflict: 'append',
    });
  });

  test('the same part of two reactions gives two digests', () => {
    expect(hashOf.latest).not.toBe(hashOf.chan);
    expect(hashOf.tally).not.toBe(hashOf.chan);
  });

  test('the same part in two scopes gives two keys', () => {
    const reaction = reactionOf(registry, 'ordered');
    const first = reactionJobKey(reaction, event, 'chan', secret);
    const second = reactionJobKey(reaction, event, 'chan', otherSecret);
    expect(second.value).not.toBe(first.value);
    expect(second.value).toBe(
      'logs.ordered:5e930b204970088728dc492202136034575e0cbb26edfb4146ab3176b553e8b4',
    );
  });

  test('the declared key never appears in the clear', () => {
    const key = reactionJobKey(reactionOf(registry, 'ordered'), event, 'ada@example.com', secret);
    expect(key.value).not.toContain('example');
    expect(key.value).toMatch(/^logs\.ordered:[0-9a-f]{64}$/);
  });
});
