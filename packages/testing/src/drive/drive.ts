import type { AnyRequest } from '@keelwerk/core';
import { isKeelwerkError } from '@keelwerk/core';
import type { DriveDecisionInput } from '@keelwerk/core/replay';
import { driveDecision } from '@keelwerk/core/replay';
import { expect } from 'vitest';
import { harnessAddress } from '../harness/harness-address.ts';
import type { TestApp } from '../harness/test-app.ts';
import { assertSame } from './assert-same.ts';
import type { DraftMatcher } from './draft-matcher.ts';
import type { DriveExpectation } from './drive-expectation.ts';
import type { DriveOptions } from './drive-options.ts';
import { drivePrincipal } from './drive-principal.ts';
import type { DriveRun } from './drive-run.ts';
import type { RequestMatcher } from './request-matcher.ts';

type Registry = TestApp['registry'];

interface Step {
  readonly matcher: RequestMatcher;
  readonly value: unknown;
}

const tenant = {
  level: 'tenant',
  backendId: harnessAddress.backendId,
  tenantId: '00000000-0000-4000-8000-0000000000a1',
} as const;

function refOfPrefix(registry: Registry, prefix: string): string {
  for (const entry of registry.entities.values()) if (entry.prefix === prefix) return entry.ref;
  return expect.fail(`no entity of the app has the id prefix "${prefix}"`);
}

function summaryOfRequest(request: AnyRequest): unknown {
  switch (request.kind) {
    case 'load':
      return {
        kind: 'load',
        module: request.module,
        entity: request.entity,
        op: request.op,
        args: request.args,
      };
    case 'id':
      return { kind: 'id', entity: request.entity };
    case 'random':
      return { kind: 'random', bytes: request.bytes };
    case 'flag':
      return { kind: 'flag', key: request.key };
    default:
      return { kind: request.kind };
  }
}

function summaryOfMatcher(registry: Registry, matcher: RequestMatcher): unknown {
  switch (matcher.kind) {
    case 'load':
      return {
        kind: 'load',
        module:
          registry.modules.find((module) => module.contextName === matcher.module)?.id ??
          matcher.module,
        entity: matcher.entity,
        op: matcher.op,
        args: matcher.args,
      };
    case 'id':
      return { kind: 'id', entity: refOfPrefix(registry, matcher.prefix) };
    default:
      return matcher;
  }
}

function summaryOfDraft(draft: { kind: string; entity: string; id: string; values: unknown }) {
  return { kind: draft.kind, entity: draft.entity, id: draft.id, values: draft.values };
}

function summaryOfDraftMatcher(registry: Registry, matcher: DraftMatcher): unknown {
  return {
    kind: matcher.kind,
    entity: refOfPrefix(registry, matcher.prefix),
    id: matcher.id ?? expect.any(String),
    values: matcher.values,
  };
}

/**
 * Drives a command's `decide` with answers as data (section 7.9.6): no storage, no runtime. The
 * handler gets its real context; each request it yields must be the next one expected, and gets
 * the answer given with it. `command` is the part `defineCommand` returned, or its reference.
 *
 * ```ts
 * const run = drive(app, register, { input })
 * run.expect(load.accounts.profile.exists({ email })).answer(false)
 * run.expect(newId(profile)).answer('prof_01j9')
 * await run.returns({ events: [created(profile, { id: 'prof_01j9', email })], result: { profileId: 'prof_01j9' } })
 * ```
 */
export function drive(
  app: TestApp,
  command: { readonly ref?: string } | string,
  options: DriveOptions,
): DriveRun {
  const { registry } = app;
  const ref = typeof command === 'string' ? command : command.ref;
  const action = ref === undefined ? undefined : registry.actions.get(ref);
  if (action === undefined) {
    return expect.fail(`"${ref ?? 'the part'}" is not a command of the app`);
  }
  const steps: Step[] = [];
  const execute = async () => {
    const queue = [...steps];
    const input: DriveDecisionInput = {
      registry,
      action,
      input: options.input,
      principal: drivePrincipal(
        options.principal ?? { subject: 'tester', roles: [], claims: {} },
        tenant,
      ),
      scope: tenant,
      clock: { now: () => options.now ?? Temporal.Instant.from('2026-01-01T00:00:00Z') },
      ...(options.target === undefined ? {} : { target: options.target }),
      config: (module) =>
        module === (action.contributedBy ?? action.module) ? options.config : undefined,
      answer: (request) => {
        const step = queue.shift();
        if (step === undefined) {
          return expect.fail(
            `the handler made a request nothing expected: ${JSON.stringify(summaryOfRequest(request), (_key, value) => (typeof value === 'bigint' ? value.toString() : value))}`,
          );
        }
        assertSame(
          'the handler yielded another request than the next one expected',
          summaryOfRequest(request),
          summaryOfMatcher(registry, step.matcher),
        );
        return step.value;
      },
    };
    const decided = await driveDecision(input);
    expect(queue.length, 'requests were expected and never made').toBe(0);
    return decided;
  };
  const run: DriveRun = {
    expect(matcher) {
      return {
        answer(value) {
          steps.push({ matcher, value });
          return run;
        },
      };
    },
    async returns(expected: DriveExpectation) {
      const decided = await execute();
      const wanted = expected.events ?? [];
      assertSame(
        'the handler returned other events than expected',
        decided.drafts.map(summaryOfDraft),
        wanted.map((draft) => summaryOfDraftMatcher(registry, draft)),
      );
      assertSame(
        'the handler returned another result than expected',
        decided.result,
        expected.result,
      );
    },
    async throws(code) {
      const error = await execute().then(
        () => undefined,
        (caught: unknown) => caught,
      );
      if (error !== undefined && !isKeelwerkError(error)) throw error;
      expect(error, 'the handler was expected to fail').toBeDefined();
      if (isKeelwerkError(error)) expect(error.code).toBe(code);
    },
  };
  return run;
}
