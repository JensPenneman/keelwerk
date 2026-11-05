import type { Id, SubjectId } from '@keelwerk/core';

/** With accounts selected a user's subject is the id of the profile (17.2.1). */
export function subjectOfProfile(profileId: Id<'accounts.profile'>): SubjectId {
  return profileId as string as SubjectId;
}
