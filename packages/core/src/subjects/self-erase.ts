import type { RuleEntry } from '../registry/rule-entry.ts';
import { sameSubject } from './same-subject.ts';

/**
 * The rule that lets a user erase their own subject (`core.eraseSubject`, section 14.7.5). It is
 * not part of the core's own rules: self-service deletion is the platform's decision. In a business
 * tenant the tenant decides what has to be kept, the action cannot be undone, and a rule on a core
 * action cannot yet ask for a recent re-authentication. A platform that wants it adds the rule
 * (`policies.add: [selfErase]`, section 8.7); the rule compares the principal's subject with the
 * subject in the input (`sameSubject`: one subject in any of its spellings), and it is off whenever it is not in `policies.add`.
 */
export const selfErase: RuleEntry = {
  id: 'core.eraseSubject.selfErase',
  module: 'core',
  effect: 'allow',
  subject: { module: 'core' },
  actions: ['eraseSubject'],
  principal: 'user',
  when: (context, input) => {
    const { subject } = (context as { readonly principal: { readonly subject?: unknown } })
      .principal;
    return (
      typeof subject === 'string' &&
      sameSubject(subject, String((input as { readonly subjectId?: unknown }).subjectId))
    );
  },
  reason: 'A user erases their own subject.',
  disabled: false,
};
