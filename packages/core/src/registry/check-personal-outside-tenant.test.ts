import { describe, expect, test } from 'vitest';
import type { FieldDescriptor } from '../storage/field-descriptor.ts';
import { checkPersonalOutsideTenant } from './check-personal-outside-tenant.ts';
import type { EntityEntry } from './entity-entry.ts';

const plain = { kind: 'string', personal: false, inner: null } as unknown as FieldDescriptor;
const personal = {
  kind: 'string',
  personal: { subject: 'id' },
  inner: null,
} as unknown as FieldDescriptor;
const personalList = {
  kind: 'list',
  personal: false,
  inner: personal,
} as unknown as FieldDescriptor;

function entry(
  ref: string,
  tenancy: string,
  fields: Record<string, FieldDescriptor>,
  dataSubject: string | null = null,
): readonly [string, EntityEntry] {
  return [ref, { ref, module: 'm', descriptor: { tenancy, fields, dataSubject } } as never];
}

describe('checkPersonalOutsideTenant (14.7.5)', () => {
  test('a tenant entity may hold personal values', () => {
    const problems = checkPersonalOutsideTenant(
      new Map([entry('m.person', 'tenant', { email: personal }, 'id')]),
    );
    expect(problems).toEqual([]);
  });

  test('a backend, deployment or invocation entity with a personal field is refused', () => {
    for (const tenancy of ['backend', 'deployment', 'invocation']) {
      const [problem] = checkPersonalOutsideTenant(
        new Map([entry('m.thing', tenancy, { email: personal })]),
      );
      expect(problem).toMatchObject({
        code: 'personalOutsideTenant',
        severity: 'error',
        module: 'm',
        ref: 'm.thing',
      });
    }
  });

  test('a personal element of a list counts, and so does a data subject alone', () => {
    expect(
      checkPersonalOutsideTenant(new Map([entry('m.a', 'backend', { emails: personalList })])),
    ).toHaveLength(1);
    expect(
      checkPersonalOutsideTenant(new Map([entry('m.b', 'backend', { name: plain }, 'id')])),
    ).toHaveLength(1);
  });

  test('a backend entity without personal values is fine', () => {
    expect(checkPersonalOutsideTenant(new Map([entry('m.c', 'backend', { name: plain })]))).toEqual(
      [],
    );
  });
});
