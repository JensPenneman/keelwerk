/**
 * The attributes the kernel puts into a targeting row (20.3); a rule's `when` reads these only.
 * Enrichers are deferred (S-135): their names join the list when they exist.
 */
export const targetingAttributeNames: readonly string[] = ['principalKind', 'principalRoles'];
