import { describe, expect, it } from 'vitest';
import { defineModule } from './define-module.ts';
import { defineModuleBase } from './define-module-base.ts';

describe('the migrations member of the module literal (S-08)', () => {
  const base = defineModuleBase({ id: 'notes', version: '0.1.0' });

  it('is kept on the module value', () => {
    const migrations = new URL('file:///packages/module-notes/migrations/');
    expect(defineModule(base, { migrations }).migrations).toBe(migrations);
  });

  it('is absent when the module ships no migrations', () => {
    expect('migrations' in defineModule(base, {})).toBe(false);
  });
});
