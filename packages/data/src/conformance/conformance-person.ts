import type {
  DerivedIndexField,
  EntityDescriptor,
  FieldDescriptor,
  NormalizerRef,
  PersonalQuery,
} from '@keelwerk/core';
import { unicodeVersion } from '@keelwerk/core';
import { conformanceEntity } from './conformance-entity.ts';
import { conformanceField } from './conformance-field.ts';

function personal(
  queries: readonly PersonalQuery[],
  normalize: NormalizerRef['id'],
): Exclude<FieldDescriptor['personal'], false> {
  return {
    subject: 'subject',
    queries,
    normalize: { id: normalize, version: 1 },
    params: {
      eq: { bits: 128 },
      prefix: { min: 3, max: 32 },
      contains: { bits: 12 },
      order: { bytes: 16 },
    },
    keys: 'tenant',
  };
}

function derivedOf(field: string, column: string, query: PersonalQuery): DerivedIndexField {
  return {
    field,
    kind: query === 'eq' ? 'binary' : 'tagSet',
    query,
    column: `${column}__${query}`,
    keyVersion: 1,
    unicode: unicodeVersion(),
  };
}

const columns: Readonly<Record<string, readonly [string, readonly PersonalQuery[]]>> = {
  exactName: ['exact_name', ['eq']],
  nfcName: ['nfc_name', ['eq']],
  caselessName: ['caseless_name', ['eq']],
  mail: ['mail', ['eq', 'prefix']],
  age: ['age', ['eq']],
  handle: ['handle', ['eq']],
  address: ['address', ['eq']],
  note: ['note', []],
};

/**
 * The personal fields of the conformance app (14.7.9): one string field per normaliser (`exact`,
 * `nfc`, `caseless`, `email`), an integer, a unique `caseless` handle, a unique `email` address and a field without queries,
 * all owned by the data subject in `subject`. `mail` also declares `prefix`, which the adapters
 * answer by the bounded scan (S-37).
 */
export const conformancePerson: EntityDescriptor = (() => {
  const base = conformanceEntity('conf.person', 'tenant', {
    subject: conformanceField('subject', 'subject'),
    label: conformanceField('string', 'label'),
    exactName: conformanceField('string', 'exact_name', { personal: personal(['eq'], 'exact') }),
    nfcName: conformanceField('string', 'nfc_name', { personal: personal(['eq'], 'nfc') }),
    caselessName: conformanceField('string', 'caseless_name', {
      personal: personal(['eq'], 'caseless'),
    }),
    mail: conformanceField('string', 'mail', { personal: personal(['eq', 'prefix'], 'email') }),
    age: conformanceField('integer', 'age', { personal: personal(['eq'], 'exact') }),
    handle: conformanceField('string', 'handle', {
      unique: true,
      personal: personal(['eq'], 'caseless'),
    }),
    address: conformanceField('string', 'address', {
      unique: true,
      personal: personal(['eq'], 'email'),
    }),
    note: conformanceField('string', 'note', { personal: personal([], 'nfc') }),
  });
  const derived: Record<string, DerivedIndexField> = {};
  for (const [field, [column, queries]] of Object.entries(columns)) {
    for (const query of queries) {
      derived[`${column}__${query}`] = derivedOf(field, column, query);
    }
  }
  return { ...base, dataSubject: 'subject', derivedIndexes: derived };
})();
