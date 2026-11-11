import {
  defineEntity,
  defineError,
  defineFlag,
  defineModuleBase,
  type EntityType,
  field,
  type ModuleBaseType,
} from '@keelwerk/core';

const signalDef = defineEntity({
  prefix: 'rsg',
  dataSubject: 'owner',
  fields: {
    channel: field.string({ maxLength: 40 }),
    text: field.string({ maxLength: 200 }),
    owner: field.subject(),
    contact: field.string({ maxLength: 100 }).personal().optional(),
    internalNote: field.string({ maxLength: 100 }).hidden().optional(),
  },
});
interface Signal extends EntityType<typeof signalDef> {}
const signal: Signal = signalDef;

/** What the reactions write: one row per decision, named by the reaction that made it. */
const echoDef = defineEntity({
  prefix: 'rec',
  fields: {
    reaction: field.string({ maxLength: 80 }),
    channel: field.string({ maxLength: 40 }),
    signal: field.string({ maxLength: 80 }),
    count: field.integer().optional(),
    seenText: field.string({ maxLength: 200 }).optional(),
  },
});
interface Echo extends EntityType<typeof echoDef> {}
const echo: Echo = echoDef;

const relayBaseDef = defineModuleBase({
  id: 'relay',
  version: '0.1.0',
  entities: { signal, echo },
  flags: {
    open: defineFlag({
      kind: 'boolean',
      default: false,
      level: 'tenant',
      purpose: 'release',
      expires: '2027-06-30',
    }),
  },
});
interface RelayBase extends ModuleBaseType<typeof relayBaseDef> {}
const relayBase: RelayBase = relayBaseDef;

const rejected = defineError('relay.rejected', { kind: 'validation', message: 'Refused.' });
const forwardRefused = defineError('relay.forward_refused', {
  kind: 'validation',
  message: 'The relay could not forward it.',
});

/** Writes an echo row for the signal: `reaction`, its channel and the signal's id. */
function echoOf(
  ctx: { readonly write: { readonly relay: { readonly echo: { create: (v: never) => unknown } } } },
  id: string,
  values: { reaction: string; channel: string; signal: string; count?: number; seenText?: string },
): never {
  return ctx.write.relay.echo.create({ id, ...values } as never) as never;
}

const channelOf = (event: {
  readonly current?: unknown;
  readonly stream: { readonly id: string };
}) => String((event.current as { channel?: string } | undefined)?.channel ?? event.stream.id);

export { channelOf, echo, echoOf, forwardRefused, rejected, relayBase, signal };
