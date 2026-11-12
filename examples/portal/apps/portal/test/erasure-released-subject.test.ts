import type { ModuleBaseType, ModuleType } from '@keelwerk/core';
import {
  defineApp,
  defineFlag,
  defineModule,
  defineModuleBase,
  flagScrubCommandId,
  parseSealedValueText,
  selfErase,
} from '@keelwerk/core';
import { erasure } from '@keelwerk/events';
import { auth } from '@keelwerk/module-auth';
import { createLocalClient, startTestRuntime, testOperator } from '@keelwerk/testing';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { credentialsOf, freshPerson } from './support/people.ts';
import { localConfig } from './support/portal-config.ts';

/** A module that only declares the flag whose rule names the subject. */
const flaggedBaseDef = defineModuleBase({
  id: 'flagged',
  version: '0.1.0',
  flags: {
    beta: defineFlag({
      kind: 'boolean',
      default: false,
      level: 'tenant',
      purpose: 'release',
      expires: '2027-06-30',
    }),
  },
});
interface FlaggedBase extends ModuleBaseType<typeof flaggedBaseDef> {}
const flaggedDef = defineModule(flaggedBaseDef as FlaggedBase, {});
interface Flagged extends ModuleType<typeof flaggedDef> {}
const flagged: Flagged = flaggedDef;

/** The auth module and a flag, without accounts, so the subject is auth's opaque subject of 32 hex digits, with the rule a platform adds to let a user erase their own subject. */
const app = defineApp({
  id: 'portal-auth',
  modules: [auth, flagged] as const,
  policies: { add: [selfErase] },
});

describe('erasing a subject written by the released auth module (32 hex digits, 14.7.5)', () => {
  const worker = erasure({ pollMs: 3_600_000 });
  let runtime: Awaited<ReturnType<typeof boot>>;

  const boot = () =>
    startTestRuntime(app, {
      adapter: 'pglite',
      operators: true,
      config: { auth: localConfig.auth },
      workers: true,
      eventWorkers: [worker],
    });

  beforeAll(async () => {
    runtime = await boot();
  }, 120_000);

  afterAll(() => runtime?.stop());

  /**
   * One person signs up, logs in, acts as their own principal and is named by a flag rule; then
   * `erase` asks for their erasure with the subject spelled as it chooses. Afterwards the credential
   * row is erased, the receipts of the sign-up, the login and the subject principal are purged, and
   * the flag rule is scrubbed.
   */
  const eraseAndCheck = async (
    erase: (input: {
      readonly subject: string;
      readonly commandId: string;
      readonly bearer: Record<string, string>;
      readonly request: (
        action: string,
        input: unknown,
        headers?: Record<string, string>,
        commandId?: string,
      ) => ReturnType<typeof runtime.invoker.invoke>;
    }) => Promise<boolean>,
  ) => {
    const tenantHeaders = { 'x-tenant': runtime.tenants.acme.id };
    const request = (
      action: string,
      input: unknown,
      headers: Record<string, string> = {},
      commandId?: string,
    ) =>
      runtime.invoker.invoke({
        action,
        input,
        carrier: { transport: 'test', headers: { ...tenantHeaders, ...headers } },
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
        ...(commandId === undefined ? {} : { commandId }),
      });
    const scope = {
      level: 'tenant',
      backendId: runtime.backendId,
      tenantId: runtime.tenants.acme.id,
    } as const;
    const descriptor = (ref: string) => {
      const found = runtime.app.registry.entities.get(ref)?.descriptor;
      if (found === undefined) throw new Error(`the portal has no ${ref}`);
      return found;
    };

    const person = freshPerson('released');
    expect((await request('auth.signUp', person)).ok).toBe(true);
    const login = await request('auth.login', credentialsOf(person));
    if (!login.ok) throw login.error;
    const bearer = {
      authorization: `Bearer ${(login.value as { sessionToken: string }).sessionToken}`,
    };
    const whoami = await request('auth.whoami', {}, bearer);
    if (!whoami.ok) throw whoami.error;
    const subject = String((whoami.value as { subject: string }).subject);
    // The stored format of the released version: 32 hex digits, no hyphens.
    expect(subject).toMatch(/^[0-9a-f]{32}$/);

    // A receipt of the session the person holds (a person is signed in by a session, whose id is the principal id of their requests), the receipts of the sign-up and the login and a
    // flag rule that names the subject.
    const { sessionId } = login.value as { sessionId: string };
    const extended = await request('auth.extendSession', { sessionId }, bearer);
    expect(extended.ok).toBe(true);
    const flag = await runtime.invoker.invoke({
      action: 'core.flag.set',
      input: {
        key: 'flagged.beta',
        backendId: runtime.backendId,
        targeting: {
          enabled: true,
          rules: [{ id: 'one', principals: [subject], serve: { value: true } }],
          fallthrough: { value: false },
        },
        reason: 'released subject',
      },
      carrier: { transport: 'test', local: { inProcess: true } },
      requestId: crypto.randomUUID(),
      commandId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
    expect(flag.ok).toBe(true);

    const stateOf = () =>
      runtime.sealed.unit(
        runtime.namespace,
        scope,
        async (unit) => {
          const owned = (await unit.rows.find(descriptor('auth.credential'), {})).rows.filter(
            (row) => row.subject === subject,
          );
          const receipts = (await unit.rows.find(descriptor('core.commandReceipt'), {})).rows;
          return {
            credentials: owned.length,
            ofSubject: receipts.filter(
              (row) =>
                [subject, sessionId].includes(String(row.principalId)) &&
                row.action !== 'core.eraseSubject',
            ).length,
            ofCallers: receipts.filter((row) =>
              ['auth.signUp', 'auth.login'].includes(String(row.action)),
            ).length,
          };
        },
        { readOnly: true },
      );
    // The value key that seals the credential's verifier: the erasure must destroy it and tombstone it in the ledger.
    const verifierKeys = await runtime.sealed.unit(
      runtime.namespace,
      scope,
      async (unit) =>
        (await unit.rows.find(descriptor('auth.credential'), { includeArchived: true })).rows
          .filter((row) => row.subject === subject)
          .flatMap((row) => parseSealedValueText(String(row.verifier))?.keyId ?? []),
      { readOnly: true },
    );
    expect(verifierKeys).toHaveLength(1);
    const before = await stateOf();
    expect(before.credentials).toBe(1);
    expect(before.ofSubject).toBeGreaterThan(0);
    expect(before.ofCallers).toBe(2);

    const commandId = crypto.randomUUID();
    expect(await erase({ subject, commandId, bearer, request })).toBe(true);
    await runtime.drainJobs();
    await worker.pass();
    await runtime.drainJobs();

    expect(await stateOf()).toEqual({ credentials: 0, ofSubject: 0, ofCallers: 0 });
    // The destroyed value key is in the control ledger as a tombstone, so a restored backup shreds it again (14.7.6), whichever spelling the erasure was asked for.
    const tombstoned = await runtime.control.adapter.unit(
      runtime.control.namespace,
      { level: 'deployment' },
      async (unit) =>
        ((await unit.ledger?.since(0n, 1000)) ?? []).flatMap((entry) =>
          entry.record.type === 'keyTombstone' ? [entry.record.keyId] : [],
        ),
      { readOnly: true },
    );
    expect(tombstoned).toEqual(expect.arrayContaining(verifierKeys));
    const scrubbed = await runtime.control.adapter.unit(
      runtime.control.namespace,
      { level: 'deployment' },
      async (unit) =>
        (await unit.events.readAll(null, { limit: 500 })).events.filter(
          (event) =>
            event.stream.type === 'core.flag' &&
            event.commandId ===
              flagScrubCommandId({
                tenantId: runtime.tenants.acme.id,
                commandId,
                subjectId: subject,
              }),
        ),
      { readOnly: true },
    );
    expect(scrubbed.length).toBeGreaterThan(0);
    expect(JSON.stringify(scrubbed.map((event) => event.data))).not.toContain(subject);
  };

  test(
    'the user erases their own subject: rows erased, receipts purged, the flag rule scrubbed',
    {
      timeout: 180_000,
    },
    () =>
      eraseAndCheck(
        async ({ subject, commandId, bearer, request }) =>
          (
            await request(
              'core.eraseSubject',
              { subjectId: subject, reason: 'subjectRequest' },
              bearer,
              commandId,
            )
          ).ok,
      ),
  );

  test(
    'an operator erases the hyphenated spelling of the same subject: the same erasure',
    {
      timeout: 180_000,
    },
    () =>
      eraseAndCheck(async ({ subject, commandId }) => {
        const hyphenated = [8, 4, 4, 4, 12]
          .map((length, at, lengths) => {
            const from = lengths.slice(0, at).reduce((sum, part) => sum + part, 0);
            return subject.slice(from, from + length);
          })
          .join('-');
        expect(hyphenated).not.toBe(subject);
        const accepted = await createLocalClient(runtime, {
          principal: testOperator(),
          tenant: 'acme',
        }).attempt(
          'core.eraseSubject',
          { subjectId: hyphenated, reason: 'operator' },
          { commandId },
        );
        return accepted.ok;
      }),
  );
});
