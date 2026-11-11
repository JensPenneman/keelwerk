import { describe, expect, test } from 'vitest';
import { isKernelCommandId } from './is-kernel-command-id.ts';
import { kernelCommandId } from './kernel-command-id.ts';
import { refuseReservedCommandId } from './refuse-reserved-command-id.ts';

describe('the command ids the kernel makes itself', () => {
  test('golden: kernel, the kind and the parts, joined by colons', () => {
    expect(kernelCommandId('reaction', 'relay.echo', 'e1')).toBe('kernel:reaction:relay.echo:e1');
    expect(kernelCommandId('continuation', 'f1')).toBe('kernel:continuation:f1');
    expect(kernelCommandId('effect', 'f1')).toBe('kernel:effect:f1');
  });

  test('the predicate recognises every id the helper builds and no other', () => {
    expect(isKernelCommandId(kernelCommandId('effect', 'x'))).toBe(true);
    for (const id of [
      'relay.echo:e1',
      'Kernel:x',
      ' kernel:x',
      '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a10',
    ]) {
      expect(isKernelCommandId(id)).toBe(false);
    }
  });

  test('a caller-chosen id in the form is a validation error with a registered code, anything else passes', () => {
    expect(() => refuseReservedCommandId(kernelCommandId('reaction', 'a.b', 'e'))).toThrow(
      expect.objectContaining({
        kind: 'validation',
        code: 'core.command_id_reserved',
        issues: [expect.objectContaining({ path: ['commandId'] })],
      }),
    );
    expect(() => refuseReservedCommandId('relay.echo:e1')).not.toThrow();
    expect(() => refuseReservedCommandId(undefined)).not.toThrow();
  });
});
