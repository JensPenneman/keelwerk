import type { Registry } from '@keelwerk/core';
import type { PersonalFieldFact } from './deployment-facts.ts';

/** The personal fields of the registries' entities, with the declarations doctor judges (section 14.7.9.12). */
export function personalFieldsOf(registries: readonly Registry[]): readonly PersonalFieldFact[] {
  const facts: PersonalFieldFact[] = [];
  for (const registry of registries) {
    for (const [ref, entry] of registry.entities) {
      for (const [name, field] of Object.entries(entry.descriptor.fields)) {
        if (field.personal === false) continue;
        facts.push({
          field: `${ref}.${name}`,
          kind: field.kind,
          queries: field.personal.queries,
          keys: field.personal.keys === 'tenant' ? 'tenant' : 'subject',
          normalizer: `${field.personal.normalize.id}/${field.personal.normalize.version}`,
          prefixMin: field.personal.params.prefix.min,
          containsBits: field.personal.params.contains.bits,
          searchKeys: entry.descriptor.searchIndexes
            .filter((index) => index.fields.includes(name) && index.keys !== null)
            .map((index) => (index.keys === 'tenant' ? 'tenant' : 'subject')),
          distinctValues: undefined,
          indexRows: undefined,
          indexBytes: undefined,
          failedReindexJobs: 0,
          plaintextBackups: false,
          otherUnicodeVersion: false,
        });
      }
    }
  }
  return facts;
}
