import type { DecideContext } from '../contexts/decide-context.ts';
import type { CoreBase } from '../core-module/core-base-type.ts';
import { shape } from '../fields/shape.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { HookEntry } from '../registry/hook-entry.ts';
import { hookPayloadShape } from './hook-payload-shape.ts';

/**
 * The command a lifecycle hook decides as (S-27): the hook's id as ref, its module (the contributing
 * module when it has one), a command of the hook's unit level, gated by the rules, whose input is the
 * hook's payload and whose handler is the hook's `react`.
 */
export function hookActionOf(hook: HookEntry, since: string): ActionEntry {
  return {
    ref: hook.id,
    module: hook.contributedBy ?? hook.module,
    name: hook.id.slice(hook.id.indexOf('.') + 1),
    mount: 'module',
    kind: 'command',
    instance: false,
    input: hookPayloadShape,
    output: shape({}),
    errors: [],
    auth: 'policy',
    scope: hook.unit,
    execution: 'sync',
    idempotent: false,
    offline: false,
    resumable: false,
    hints: {},
    since,
    changedIn: [],
    handler: (input: unknown, ctx: unknown) => hook.react(input, ctx as DecideContext<CoreBase>),
  };
}
