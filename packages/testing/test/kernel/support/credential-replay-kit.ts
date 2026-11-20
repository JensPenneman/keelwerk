import type { ActionEntry, DataAdapter, Receipt, Registry, Unit } from '@keelwerk/core';
import { errors, field, type KeelwerkError, shape } from '@keelwerk/core';
import { withCommand } from './command-kit.ts';
import { deriveOnlyKeys } from './derive-only-keys.ts';
import { receiptOf } from './effects-kit.ts';
import { namespace, tenant } from './run-read-kit.ts';

export const firstId = '00000000-0000-7000-8000-0000000000a1';
export const secondId = '00000000-0000-7000-8000-0000000000b2';
export const thirdId = '00000000-0000-7000-8000-0000000000c3';
export const mismatchRefusal = { kind: 'conflict', code: 'core.idempotency_mismatch' };
export const opened = shape({ door: field.string() });
export const pinnedInput = { door: field.string(), pin: field.secret() };

/** What a caller can see of a refusal, member by member. */
export function visible(error: unknown) {
  const e = error as KeelwerkError & { issues?: unknown; retryAfter?: unknown };
  return {
    kind: e.kind,
    code: e.code,
    message: e.message,
    details: e.details,
    retryable: e.retryable,
    issues: e.issues,
    retryAfter: e.retryAfter,
  };
}

/** The probes: every command is public; the handler of `door` and `gate` opens only for the pin 4711. */
export function credentialProbes(calls: { n: number }) {
  const strict = (input: unknown) => {
    calls.n += 1;
    if ((input as { pin?: string }).pin !== '4711') throw errors.forbidden('Wrong pin.');
    return { events: [], result: { door: 'open' } };
  };
  const lenient = () => {
    calls.n += 1;
    return { events: [], result: { door: 'open' } };
  };
  const issue = () => {
    calls.n += 1;
    return { events: [], result: { token: 'tok' } };
  };
  const specs: Record<string, [ActionEntry['handler'], string, Partial<ActionEntry>]> = {
    door: [
      strict as never,
      'library.book.reserve',
      { input: shape({ id: field.string(), pin: field.secret() }), output: opened },
    ],
    gate: [
      strict as never,
      'library.addBook',
      { input: shape(pinnedInput), output: opened, execution: 'either' },
    ],
    token: [
      issue as never,
      'library.addBook',
      { input: shape(pinnedInput), output: shape({ token: field.string() }), shownOnce: ['token'] },
    ],
    maybe: [
      lenient as never,
      'library.addBook',
      { input: shape({ door: field.string(), pin: field.secret().optional() }), output: opened },
    ],
    pins: [
      lenient as never,
      'library.addBook',
      { input: shape({ door: field.string(), pins: field.list(field.secret()) }), output: opened },
    ],
    nested: [
      lenient as never,
      'library.addBook',
      {
        input: shape({ door: field.string(), guard: field.json(shape({ pin: field.secret() })) }),
        output: opened,
      },
    ],
    plain: [
      lenient as never,
      'library.addBook',
      { input: shape({ door: field.string(), note: field.string() }), output: opened },
    ],
  };
  let registry: Registry | undefined;
  const refs: Record<string, string> = {};
  for (const [name, [handler, from, over]] of Object.entries(specs)) {
    const added = withCommand(name, handler, from, over);
    refs[name] = added.ref;
    registry =
      registry === undefined
        ? added.registry
        : { ...registry, actions: new Map([...registry.actions, ...added.registry.actions]) };
  }
  if (registry === undefined) throw new Error('no probes');
  // `door` is an instance command: the rule of `library.book.reserve`, cloned for it, lets any caller load its target.
  const reservers = registry.rules.get('loans.library.book.reservers');
  if (reservers === undefined) throw new Error('the loans fixture has no reservers rule');
  const { principal: _principal, ...open } = reservers;
  const rule = { ...open, id: 'loans.library.book.door', actions: ['door'] };
  registry = { ...registry, rules: new Map([...registry.rules, [rule.id, rule]]) };
  return { registry, ref: (name: string) => refs[name] as string };
}

/** An adapter that records every call on the stores a refused repeat must not reach. */
export function spied(inner: DataAdapter): { adapter: DataAdapter; log: string[] } {
  const log: string[] = [];
  const watched = ['rows', 'events', 'streams', 'jobs', 'keys', 'serials'];
  const watch = (unit: Unit): Unit =>
    new Proxy(unit, {
      get(target, key, receiver) {
        const value: unknown = Reflect.get(target, key, receiver);
        if (typeof key !== 'string' || !watched.includes(key) || typeof value !== 'object')
          return value;
        return new Proxy(value as object, {
          get(store, member) {
            const entry: unknown = Reflect.get(store, member);
            if (typeof entry !== 'function') return entry;
            return (...args: unknown[]) => {
              log.push(`${key}.${String(member)}`);
              return (entry as (...a: unknown[]) => unknown).apply(store, args);
            };
          },
        });
      },
    });
  return {
    log,
    adapter: {
      ...inner,
      unit: (ns, scope, fn, options) => inner.unit(ns, scope, (unit) => fn(watch(unit)), options),
    },
  };
}

export const spyKeys = (used: string[]) =>
  new Proxy(deriveOnlyKeys, {
    get(target, key, receiver) {
      used.push(String(key));
      return Reflect.get(target, key, receiver) as unknown;
    },
  });

export const putReceipt = (adapter: DataAdapter, receipt: Receipt) =>
  adapter.unit(namespace, tenant, (unit) => unit.receipts.put(receipt));

export async function storedReceipt(adapter: DataAdapter, commandId: string): Promise<Receipt> {
  const receipt = await receiptOf(adapter, commandId);
  if (receipt === undefined) throw new Error(`no receipt ${commandId}`);
  return receipt;
}
