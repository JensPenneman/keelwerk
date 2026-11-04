import { normalizeRule } from '../authorization/normalize-rule.ts';
import type { NormalizedRule } from '../authorization/normalized-rule.ts';
import { errors } from '../errors/errors.ts';
import { assertLoadVisible } from '../interpreter/assert-load-visible.ts';
import { buildReadContext } from '../interpreter/build-read-context.ts';
import { driveHandler } from '../interpreter/drive-handler.ts';
import { refuseRequest } from '../interpreter/refuse-request.ts';
import type { RequestAuthorities } from '../interpreter/request-authorities.ts';
import type { Clock } from '../kernel/clock.ts';
import type { Logger } from '../observability/logger.ts';
import type { Span } from '../observability/span.ts';
import type { Principal } from '../principals/principal.ts';
import type { AnyRequest } from '../protocol/any-request.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import { decodeRow } from '../repositories/decode-row.ts';
import type { Scope } from '../storage/scope.ts';
import type { StorageRow } from '../storage/storage-row.ts';
import { buildDecideContext } from '../write-path/build-decide-context.ts';
import type { NormalizedDecision } from '../write-path/normalize-decision.ts';
import { normalizeDecision } from '../write-path/normalize-decision.ts';

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

const noSpan: Span = {
  spanContext: () => ({ traceId: '0'.repeat(32), spanId: '0'.repeat(16), traceFlags: 0 }),
  setAttribute: () => noSpan,
  setAttributes: () => noSpan,
  addEvent: () => noSpan,
  addLink: () => noSpan,
  addLinks: () => noSpan,
  setStatus: () => noSpan,
  updateName: () => noSpan,
  end: () => undefined,
  isRecording: () => false,
  recordException: () => undefined,
};

/** What a decision is driven with, answers as data. */
export interface DriveDecisionInput {
  readonly registry: Registry;
  /** A command of the registry. */
  readonly action: ActionEntry;
  readonly input: unknown;
  readonly principal: Principal;
  /** The scope the principal and the context stand in. */
  readonly scope: Scope;
  readonly clock: Clock;
  /** Entity commands: the loaded row. */
  readonly target?: StorageRow;
  readonly config?: (module: string) => unknown;
  readonly rules?: readonly NormalizedRule[];
  /** Answers each request the handler yields, in order; throwing fails the drive. */
  readonly answer: (request: AnyRequest) => unknown;
}

/**
 * Runs a command's `decide` with no storage at all: the handler gets the real decide context,
 * and every request it yields goes to `answer`, which is data the test holds (section 7.9.6).
 * A `create` without an id cannot be driven: the id would be minted behind the test's back.
 */
export async function driveDecision(input: DriveDecisionInput): Promise<NormalizedDecision> {
  const { registry, action } = input;
  if (action.kind !== 'command') {
    throw errors.validation(`"${action.ref}" is not a command; only commands are driven.`);
  }
  if (action.prepare !== undefined || action.generated !== undefined) {
    throw errors.not_implemented(
      `"${action.ref}" has a generated handler or a prepare; this release drives decide only.`,
    );
  }
  const authority = action.contributedBy ?? action.module;
  const authorities: RequestAuthorities = new WeakMap();
  const contexts = buildReadContext({
    registry,
    authorities,
    rules:
      input.rules ??
      [...registry.rules.values()].filter((rule) => rule.disabled !== true).map(normalizeRule),
    principal: input.principal,
    scope: input.scope,
    clock: input.clock,
    request: { transport: 'drive', requestId: 'drive' },
    config: input.config ?? (() => undefined),
    log: silent,
    trace: noSpan,
    action,
  });
  const entry =
    action.instance && action.entity !== undefined
      ? registry.entities.get(action.entity)
      : undefined;
  if (action.instance && (entry === undefined || input.target === undefined)) {
    throw errors.validation(`"${action.ref}" is an entity command: pass the target row.`);
  }
  const ctx = buildDecideContext({
    base: contexts.forModule(authority),
    registry,
    authorities,
    module: authority,
    prepared: undefined,
    ...(entry === undefined || input.target === undefined
      ? {}
      : { target: { entry, row: input.target } }),
    newId: (entity) => {
      throw refuseRequest(
        'newId',
        `a create of ${entity} without an id mints one behind the test's back: name the id, or take it from ctx.newId`,
      );
    },
  });
  let handled: unknown;
  if (entry !== undefined && input.target !== undefined) {
    const { id: _id, ifVersion: _ifVersion, ...rest } = input.input as Record<string, unknown>;
    handled = action.handler(rest, decodeRow(entry, input.target, authority), ctx);
  } else {
    handled = action.handler(input.input, ctx);
  }
  return normalizeDecision(
    await driveHandler(handled, async (request) => {
      if (request.kind === 'load') {
        assertLoadVisible(request, { registry, module: authority, form: 'decide' }, authorities);
      }
      return input.answer(request);
    }),
  );
}
