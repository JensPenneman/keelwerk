import type { PrincipalContext } from '../../src/contexts/principal-context.ts';
import { entityDescriptor, fieldDescriptor } from './fixtures.ts';

/** The `doc.post` entity most authorization tests run against. */
export const post = entityDescriptor('doc.post', {
  title: fieldDescriptor('string'),
  status: fieldDescriptor('enum'),
  ownerId: fieldDescriptor('string'),
  revokedAt: fieldDescriptor('instant'),
  deactivatedAt: fieldDescriptor('instant'),
  secret: fieldDescriptor('string', { maskable: true }),
  note: fieldDescriptor('string', { maskable: true }),
  email: fieldDescriptor('string', { personal: ['eq'] }),
  nickname: fieldDescriptor('string', { personal: ['prefix'] }),
  bio: fieldDescriptor('string', { personal: ['eq', 'contains'] }),
  hidden: fieldDescriptor('string', { hidden: true }),
});

/** The subject of a user context, `undefined` for any other principal (so a comparison never matches). */
export function subjectOf(context: PrincipalContext): string | undefined {
  return context.principal.kind === 'user' ? context.principal.subject : undefined;
}
