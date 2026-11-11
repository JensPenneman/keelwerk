import type { EntityEntry } from '@keelwerk/core';
import { fieldDescriptor } from './field-descriptor.ts';
import { handBuiltEntry } from './hand-built-entry.ts';

/** What differs between the invocation entries a test builds. */
export interface InvocationEntryOptions {
  readonly module?: string;
  /** Extra members of the descriptor (a derived index, a search index) the planner must refuse. */
  readonly descriptor?: Partial<EntityEntry['descriptor']>;
  /** The generated actions that are switched on. */
  readonly generated?: EntityEntry['generated'];
  /** Extra fields. */
  readonly fields?: EntityEntry['descriptor']['fields'];
}

/** A hand-built entity of invocation tenancy: a unique token, a time, and a plain indexed field. */
export function invocationEntry(options: InvocationEntryOptions = {}): EntityEntry {
  const entry = handBuiltEntry({
    module: options.module ?? 'notes',
    name: 'stamp',
    prefix: 'stp',
    tenancy: 'invocation',
    tracks: [{ track: options.module ?? 'notes', contributedBy: null }],
    fields: {
      token: fieldDescriptor('token', 'string', { unique: true, tag: 1 }),
      seenAt: fieldDescriptor('seenAt', 'instant', { indexed: true, tag: 2 }),
      ...options.fields,
    },
  });
  return {
    ...entry,
    descriptor: { ...entry.descriptor, history: 'state', ...options.descriptor },
    ...(options.generated === undefined ? {} : { generated: options.generated }),
  };
}
