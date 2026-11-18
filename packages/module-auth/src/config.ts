import { field, shape } from '@keelwerk/core';

/** Sessions, re-authentication and the abuse limits of 17.2.3 and 17.2.6. */
export const config = shape({
  /**
   * The fewest characters of a new password that is the only factor (decision 479). The minimum with a
   * second factor, 8, joins with the first second factor.
   */
  minPasswordLength: field.integer({ min: 8, max: 64 }).default(15),
  sessionIdleMinutes: field.integer({ min: 5 }).default(720),
  sessionAbsoluteDays: field.integer({ min: 1 }).default(30),
  reauthenticateWithinMinutes: field.integer({ min: 1 }).default(10),
  /**
   * Sessions of one credential whose `authenticatedAt` is in the last minute: a login, the rotation
   * of a password change and a reauthentication of a session (it sets `authenticatedAt` to now)
   * each count one. A login or a password change after the cap is refused with core.rate_limited
   * and writes nothing. Only a step that proved the password counts, so the cap bounds what a
   * principal can append to its own credential.
   */
  successfulLoginsPerMinute: field.integer({ min: 1 }).default(6),
  /** Reset links delivered per credential per hour; a request after the cap answers as always and delivers nothing. */
  resetRequestsPerHour: field.integer({ min: 1 }).default(3),
  /** Attempts per minute per remote address, across sign-up and login. */
  addressAttemptsPerMinute: field.integer({ min: 1 }).default(10),
  /** Failed attempts per identifier within `identifierFailureWindowMinutes`. */
  identifierFailedAttempts: field.integer({ min: 1 }).default(5),
  identifierFailureWindowMinutes: field.integer({ min: 1 }).default(15),
});
