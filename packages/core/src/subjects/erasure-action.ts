/**
 * The reference of the erasure command: only `acceptAsyncCommand`, or the own-subject request of
 * `eraseOwnSubject` (its job asks `checkOwnSubjectErasure` and the rules when it starts), starts
 * one (section 14.7.5).
 */
export const erasureAction = 'core.eraseSubject';
