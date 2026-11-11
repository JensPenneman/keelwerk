import { describe, expect, test } from 'vitest';
import { appOf, makeModule } from '../../test/registry-kit.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { defineVersionChange } from './define-version-change.ts';

const base = { id: 'changes', version: '1.10.0' } as const;

function refusal(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(KeelwerkError);
    return (error as KeelwerkError).details;
  }
  return expect.unreachable();
}

describe('defineVersionChange (section 18.2)', () => {
  test('refuses a change whose since is above the module version', () => {
    expect(
      refusal(() => defineVersionChange(base, { since: '1.11.0', surface: [] })),
    ).toMatchObject({ code: 'invalidVersionChange', severity: 'error' });
  });

  test('accepts since equal to the module version', () => {
    expect(defineVersionChange(base, { since: '1.10.0', surface: [] })).toMatchObject({
      kind: 'versionChange',
    });
  });

  test('compares versions numerically', () => {
    const older = { id: 'changes', version: '1.9.0' } as const;
    expect(
      refusal(() => defineVersionChange(older, { since: '1.10.0', surface: [] })),
    ).toMatchObject({ code: 'invalidVersionChange' });
    expect(defineVersionChange(base, { since: '1.9.0', surface: [] }).kind).toBe('versionChange');
  });

  test('ignores a pre-release or build suffix', () => {
    const prerelease = { id: 'changes', version: '1.2.0-rc.1' } as const;
    expect(defineVersionChange(prerelease, { since: '1.2.0', surface: [] }).kind).toBe(
      'versionChange',
    );
  });

  test('accepts a change of an app source', () => {
    const app = appOf([makeModule({ id: 'sample' })]);
    expect(defineVersionChange(app.modules, { since: '9.9.9', surface: [] }).kind).toBe(
      'versionChange',
    );
  });
});
