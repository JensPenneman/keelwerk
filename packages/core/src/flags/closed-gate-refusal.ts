import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { Registry } from '../registry/registry.ts';
import { compileGate } from './compile-gate.ts';
import type { FlagSnapshot } from './flag-snapshot.ts';
import { gateOpen } from './gate-open.ts';

/**
 * The refusal of the first closed gate (20.6) of the given stage, or `undefined` when all are
 * open. A closed kill switch is `unavailable` `core.feature_suspended`; any other closed gate is
 * `forbidden` `core.feature_disabled`, named after the gate as a deny rule. Every path that
 * reaches an action answers with this one error.
 */
export function closedGateRefusal(
  registry: Registry,
  action: ActionEntry,
  flags: FlagSnapshot | undefined,
  stage: 'admit' | 'authorize',
): KeelwerkError | undefined {
  for (const gate of compileGate(registry, action)) {
    if (gate.stage !== stage || gateOpen(registry, gate, flags)) continue;
    if (stage === 'admit') {
      return new KeelwerkError({
        kind: 'unavailable',
        code: 'core.feature_suspended',
        message: `"${action.ref}" is suspended.`,
      });
    }
    return new KeelwerkError({
      kind: 'forbidden',
      code: 'core.feature_disabled',
      message: `"${action.ref}" is not enabled.`,
      rules: [{ id: gate.rule, effect: 'deny' }],
    });
  }
  return undefined;
}
