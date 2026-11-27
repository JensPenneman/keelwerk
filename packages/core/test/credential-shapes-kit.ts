import { shape } from '../src/fields/shape.ts';
import type { ActionEntry } from '../src/registry/action-entry.ts';
import type { ComposableApp } from '../src/registry/composable-app.ts';
import type { EffectEntry } from '../src/registry/effect-entry.ts';
import type { Registry } from '../src/registry/registry.ts';

/** Declared shapes and registry entries for the compose checks of credential and personal members. */
export const anySchema = {
  '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) },
} as const;

export function moduleOf(over: object = {}) {
  return {
    id: 'probe',
    base: {},
    entities: {},
    contributes: [],
    conditional: [],
    ...over,
  };
}
export const appOf = (...modules: object[]) => ({ modules }) as unknown as ComposableApp;
export const commandOf = (over: object): ActionEntry =>
  ({
    ref: 'probe.run',
    module: 'probe',
    kind: 'command',
    input: shape({}),
    output: shape({}),
    ...over,
  }) as unknown as ActionEntry;
export const effectOf = (over: object): EffectEntry =>
  ({
    ref: 'probe.send',
    module: 'probe',
    name: 'send',
    performer: 'external',
    executor: null,
    input: shape({}),
    output: shape({}),
    ...over,
  }) as unknown as EffectEntry;
export const registryOf = (
  actions: ActionEntry[] = [],
  effects: EffectEntry[] = [],
  entities: object = {},
  more: {
    readonly reactions?: { id: string; [member: string]: unknown }[];
    readonly streams?: { ref: string; [member: string]: unknown }[];
  } = {},
) =>
  ({
    actions: new Map(actions.map((action) => [action.ref, action])),
    effects: new Map(effects.map((effect) => [effect.ref, effect])),
    entities: new Map(Object.entries(entities)),
    reactions: new Map((more.reactions ?? []).map((reaction) => [reaction.id, reaction])),
    streams: new Map((more.streams ?? []).map((stream) => [stream.ref, stream])),
  }) as unknown as Registry;
export const codes = (problems: readonly { code: string }[]) =>
  problems.map((problem) => problem.code);
