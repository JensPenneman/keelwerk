import { field, shape } from '@keelwerk/core';

/** Sessions, re-authentication and the abuse limits of 17.2.3 and 17.2.6. */
export const config = shape({
  sessionIdleMinutes: field.integer({ min: 5 }).default(720),
  sessionAbsoluteDays: field.integer({ min: 1 }).default(30),
  reauthenticateWithinMinutes: field.integer({ min: 1 }).default(10),
  /** Attempts per minute per remote address, across sign-up and login. */
  addressAttemptsPerMinute: field.integer({ min: 1 }).default(10),
  /** Failed attempts per identifier within `identifierFailureWindowMinutes`. */
  identifierFailedAttempts: field.integer({ min: 1 }).default(5),
  identifierFailureWindowMinutes: field.integer({ min: 1 }).default(15),
});
