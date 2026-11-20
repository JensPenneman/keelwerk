import { afterEach, describe, expect, test } from 'vitest';
import { courierApp } from './support/courier-kit.ts';
import { redactApp, redactSwitches } from './support/redact-app.ts';
import { startExplain } from './support/started-explain.ts';

const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  redactSwitches.refuse = false;
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

const email = 'first@secret.example';
const agent = 'agent-of-ada/9.1';

/** A patient with a personal email, then `describePatient` run as ada under a user agent. */
async function described() {
  const kit = await startExplain(redactApp, cleanup);
  const made = await kit.command(
    'clinic.patient.create',
    { name: 'Ada', ownerId: 'ada', email, ward: 'ward-hidden' },
    '00000000-0000-7000-8000-0000000000f1',
  );
  if (!made.ok) throw made.error;
  const { id } = made.value as { id: string };
  const commandId = '00000000-0000-7000-8000-0000000000f2';
  const ran = await kit.command('clinic.describePatient', { id }, commandId, { agent });
  if (!ran.ok) throw ran.error;
  expect(ran.value).toMatchObject({ email, agent, name: 'Ada' });
  return { ...kit, id, commandId };
}

describe('what core.explain mode redecide shows an operator (16.11.3)', () => {
  test('a custom output is redacted by the flags of its schema: a flagged member holding the email and the user agent is hidden, a plain one is shown', {
    timeout: 60_000,
  }, async () => {
    const { explain, id, commandId } = await described();
    const answer = await explain({ mode: 'redecide', commandId, input: { id } });
    if (!answer.ok) throw answer.error;
    expect(answer.value).toMatchObject({ reproduced: true, differences: [] });
    expect(answer.value).toMatchObject({
      redecided: { result: { email: '[redacted]', agent: '[redacted]', name: 'Ada' } },
    });
    const shown = JSON.stringify(answer.value);
    expect(shown).not.toContain(email);
    expect(shown).not.toContain(agent);
  });

  test('a handler that now fails is reported by its code: its message, which carries personal values, is dropped', {
    timeout: 60_000,
  }, async () => {
    const { explain, id, commandId } = await described();
    redactSwitches.refuse = true;
    const answer = await explain({ mode: 'redecide', commandId, input: { id } });
    if (!answer.ok) throw answer.error;
    expect(answer.value).toMatchObject({
      reproduced: false,
      differences: ['the handler now fails with core.conflict'],
    });
    const shown = JSON.stringify(answer.value);
    expect(shown).not.toContain(email);
    expect(shown).not.toContain(agent);
    expect(shown).not.toContain('already admitted');
  });

  test('a guessed personal member of the input is compared by presence: every guess reproduces and the answer shows the same events for all of them', {
    timeout: 60_000,
  }, async () => {
    const { command, explain } = await startExplain(redactApp, cleanup);
    const made = await command(
      'clinic.patient.create',
      { name: 'Ada', ownerId: 'ada', email, ward: 'ward-first' },
      '00000000-0000-7000-8000-0000000000f3',
    );
    if (!made.ok) throw made.error;
    const { id } = made.value as { id: string };
    const input = {
      id,
      patch: { email: 'second@secret.example', ward: 'ward-second' },
      ifVersion: 1,
    };
    const commandId = '00000000-0000-7000-8000-0000000000f4';
    const updated = await command('clinic.patient.update', input, commandId);
    if (!updated.ok) throw updated.error;
    const shown: unknown[] = [];
    for (const guess of [email, 'second@secret.example', 'guess@secret.example']) {
      const answer = await explain({
        mode: 'redecide',
        commandId,
        input: { ...input, patch: { ...input.patch, email: guess } },
      });
      if (!answer.ok) throw answer.error;
      expect(answer.value, guess).toMatchObject({ reproduced: true, differences: [] });
      shown.push((answer.value as { redecided: { events: unknown } }).redecided.events);
    }
    expect(shown[1]).toEqual(shown[0]);
    expect(shown[2]).toEqual(shown[0]);
  });

  test('a patch that carries the unchanged email is compared by presence too: the guess equal to the value is told from no other', {
    timeout: 60_000,
  }, async () => {
    const { command, explain } = await startExplain(redactApp, cleanup);
    const made = await command(
      'clinic.patient.create',
      { name: 'Ada', ownerId: 'ada', email, ward: 'ward-first' },
      '00000000-0000-7000-8000-0000000000f8',
    );
    if (!made.ok) throw made.error;
    const { id } = made.value as { id: string };
    const input = { id, patch: { email, ward: 'ward-second' }, ifVersion: 1 };
    const commandId = '00000000-0000-7000-8000-0000000000f9';
    const updated = await command('clinic.patient.update', input, commandId);
    if (!updated.ok) throw updated.error;
    const shown: unknown[] = [];
    for (const guess of [email, 'guess@secret.example']) {
      const answer = await explain({
        mode: 'redecide',
        commandId,
        input: { ...input, patch: { ...input.patch, email: guess } },
      });
      if (!answer.ok) throw answer.error;
      expect(answer.value, guess).toMatchObject({ reproduced: true, differences: [] });
      shown.push((answer.value as { redecided: { events: unknown } }).redecided.events);
    }
    expect(shown[1]).toEqual(shown[0]);
  });

  test('a guessed personal member of an effect input is compared by presence too: no sentence names it', {
    timeout: 60_000,
  }, async () => {
    const { command, explain } = await startExplain(courierApp, cleanup);
    const input = { owner: 'ada', subject: 'hello', to: 'real@secret.example' };
    const commandId = '00000000-0000-7000-8000-0000000000f7';
    const sent = await command('courier.sendTo', input, commandId);
    if (!sent.ok) throw sent.error;
    for (const to of ['real@secret.example', 'guess@secret.example']) {
      const answer = await explain({ mode: 'redecide', commandId, input: { ...input, to } });
      if (!answer.ok) throw answer.error;
      expect(answer.value, to).toMatchObject({ reproduced: true, differences: [] });
    }
  });

  test('an empty apiVersion is a version, not a malformed request: the input check names it', {
    timeout: 60_000,
  }, async () => {
    const { command, explain } = await startExplain(redactApp, cleanup);
    const made = await command(
      'clinic.patient.create',
      { name: 'Ada', ownerId: 'ada' },
      '00000000-0000-7000-8000-0000000000f5',
    );
    if (!made.ok) throw made.error;
    const { id } = made.value as { id: string };
    const input = { id, patch: { name: 'Ada L.' }, ifVersion: 1 };
    const commandId = '00000000-0000-7000-8000-0000000000f6';
    const updated = await command('clinic.patient.update', input, commandId);
    if (!updated.ok) throw updated.error;
    const empty = await explain({ mode: 'redecide', commandId, input, apiVersion: '' });
    expect(empty).toMatchObject({
      ok: false,
      error: { kind: 'validation', message: expect.stringContaining('API version ""') },
    });
    const numeric = await explain({ mode: 'redecide', commandId, input, apiVersion: 3 });
    expect(numeric).toMatchObject({
      ok: false,
      error: {
        kind: 'validation',
        message: expect.stringContaining('"apiVersion" must be a string'),
      },
    });
  });
});
