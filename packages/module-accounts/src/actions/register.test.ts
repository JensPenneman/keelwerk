import { defineApp } from '@keelwerk/core';
import { created, drive, type EntityLoadMatchers, load, newId } from '@keelwerk/testing';
import { describe, test } from 'vitest';
import { profile } from '../entities/profile.ts';
import { accounts } from '../module.generated.ts';
import { register } from './register.ts';

const app = defineApp({ id: 'accounts', modules: [accounts] as const });
const input = { displayName: 'Ada Lovelace', email: 'ada@example.org' };
const profileId = '00000000-0000-7000-8000-000000000001';
const accountsLoads = load.accounts as { readonly profile: EntityLoadMatchers };
const exists = accountsLoads.profile.exists({ email: input.email });

describe('accounts.register', () => {
  test('self-registration off is forbidden before any load', async () => {
    const run = drive(app, register, { input, config: { allowSelfRegistration: false } });
    await run.throws('core.forbidden');
  });

  test('a free address creates the profile and answers its id', async () => {
    const run = drive(app, register, { input, config: { allowSelfRegistration: true } });
    run.expect(exists).answer(false);
    run.expect(newId(profile)).answer(profileId);
    await run.returns({
      events: [created(profile, { id: profileId, ...input })],
      result: { profileId },
    });
  });

  test('a taken address is accounts.email_taken', async () => {
    const run = drive(app, register, { input, config: { allowSelfRegistration: true } });
    run.expect(exists).answer(true);
    await run.throws('accounts.email_taken');
  });
});
