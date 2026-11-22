import { defineCheck } from './define-check.ts';
import type { DeploymentCheck } from './deployment-check.ts';
import type { PersonalFieldFact } from './deployment-facts.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { findingOf } from './finding-of.ts';

/** The personal-data pass (section 14.7.9.12): a note per personal field with its capabilities, key scope and normaliser, then a warning for each leak or weak setting the declarations show. */
function personalFieldFindings(fields: readonly PersonalFieldFact[]): readonly DoctorFinding[] {
  const found: DoctorFinding[] = [];
  const check = 'personal-fields';
  for (const field of fields) {
    const before = found.length;
    const warn = (message: string, fix: string): void => {
      found.push(findingOf(check, 'warning', field.field, message, fix));
    };
    if (field.queries.includes('eq') && (field.kind === 'boolean' || field.kind === 'enum')) {
      warn(
        `an equality index on a ${field.kind} field reveals the value to anyone who sees the index`,
        'drop the personal declaration, or the equality queries',
      );
    }
    if (field.queries.includes('prefix') && field.prefixMin < 3) {
      warn(`prefix.min is ${field.prefixMin}, below 3`, 'set prefix.min to 3 or more');
    }
    if (field.queries.includes('contains') && field.containsBits > 12) {
      warn(`contains.bits is ${field.containsBits}, above 12`, 'set contains.bits to 12 or less');
    }
    if (field.queries.includes('order')) {
      warn(
        'an order index reveals the order of every value',
        'drop order unless the product needs it',
      );
    }
    if (field.searchKeys.includes('tenant')) {
      warn(
        'a search index over the field is keyed per tenant (keys: tenant)',
        'key the index by subject',
      );
    }
    const leaks = found.slice(before).map((finding) => finding.message);
    found.splice(
      before,
      0,
      findingOf(
        check,
        'note',
        field.field,
        `capabilities: ${field.queries.join(', ') || 'none'}; key scope: ${field.keys}; normaliser: ${field.normalizer}; leaks: ${leaks.length === 0 ? 'none' : leaks.join('; ')}`,
        'none needed',
      ),
    );
  }
  return found;
}

export const personalFieldsCheck: DeploymentCheck = defineCheck({
  group: 'personal-fields',
  name: 'personal fields',
  needs: ['personalFields'],
  judge: ({ personalFields }) => personalFieldFindings(personalFields),
});
