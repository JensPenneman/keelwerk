import { describe, expect, it } from 'vitest';
import { continuationJobKey } from './continuation-job-key.ts';
import { enqueueKey } from './enqueue-key.ts';

describe('continuationJobKey', () => {
  it("the kernel's continuation key is core.continuation, a colon and the effect id", () => {
    expect(continuationJobKey('eff_1')).toBe('core.continuation:eff_1');
  });

  it("no module's keyed enqueue can equal it, a module named continuation included", () => {
    const key = continuationJobKey('eff_1');
    expect(key).not.toBe(enqueueKey('continuation', 'eff_1'));
    expect(key).not.toBe(enqueueKey('core', 'continuation:eff_1'));
    expect(key.slice(0, key.indexOf(':'))).toContain('.');
  });
});
