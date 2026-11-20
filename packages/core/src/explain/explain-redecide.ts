import type { NormalizedRule } from '../authorization/normalized-rule.ts';
import type { InvokerApp } from '../invoker/invoker-app.ts';
import { moduleConfigOf } from '../invoker/module-config-of.ts';
import type { Span } from '../observability/span.ts';
import { redecide } from '../replay/redecide.ts';
import type { RedecideResult } from '../replay/redecide-result.ts';
import { registryBehaviours } from '../write-path/registry-behaviours.ts';
import type { ExplainEnvironment } from './explain-environment.ts';
import type { ExplainRequest } from './explain-request.ts';
import type { ExplainTarget } from './explain-target.ts';
import { receiptApiVersion } from './receipt-api-version.ts';
import { redactRedecideResult } from './redact-redecide-result.ts';

/**
 * `core.explain` mode `redecide` (section 7.9.6): the recorded command is decided again with this
 * build, against the recorded reads, ids and sealed values, and compared with what was stored. The
 * input is the one the decision kept sealed unless the request gives it. The API version is the
 * request's, else the receipt's while one is left, else the session's (the digest covers it).
 * The answer is redacted as a dry run's is (16.11.3). Nothing is committed.
 */
export async function explainRedecide(input: {
  readonly env: ExplainEnvironment;
  readonly app: InvokerApp;
  readonly explained: ExplainTarget;
  readonly request: Extract<ExplainRequest, { readonly mode: 'redecide' }>;
  readonly rules: readonly NormalizedRule[];
  /** The session's API version: used only when the request gives none and no receipt is left. */
  readonly apiVersion: string;
  readonly trace: Span;
}): Promise<RedecideResult> {
  const { env, app, explained, request } = input;
  const { options } = env;
  const { scope, target, backend } = explained;
  const known = request.apiVersion ?? (await receiptApiVersion(target, scope, request.commandId));
  const apiVersion = known ?? input.apiVersion;
  const result = await redecide({
    registry: app.registry,
    adapter: target.handle.adapter,
    namespace: target.namespace,
    scope,
    commandId: request.commandId,
    ...(request.input === undefined ? {} : { input: request.input }),
    apiVersion,
    // A guessed input must not tell its personal members apart from the stored ones.
    ...(request.input === undefined ? {} : { personalByPresence: true }),
    behaviours: registryBehaviours(app.registry),
    rules: input.rules,
    keys: options.keys,
    compute: options.compute,
    clock: options.clock,
    config: moduleConfigOf(app.configShapes, explained.backendConfig),
    log: options.log,
    trace: input.trace,
    namespaceOf: (inner) =>
      inner.level === 'backend' ? (backend ?? target).namespace : target.namespace,
    ...(target.handle.capabilities === undefined
      ? {}
      : { concurrentUnits: target.handle.capabilities.processes !== 'single' }),
  });
  return redactRedecideResult(app.registry, result);
}
