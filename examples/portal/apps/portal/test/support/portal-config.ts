/**
 * The portal backend's configuration at creation: self-registration on, no API reference page,
 * and an address limit high enough for a whole scenario to arrive from the one address the host's
 * in-process dispatch has (the limit itself is the auth module's own test).
 */
export const portalConfig: Readonly<Record<string, unknown>> = {
  accounts: { allowSelfRegistration: true },
  auth: { addressAttemptsPerMinute: 1000 },
  rest: { docs: false, cors: [] },
};

/** The same without the REST module's settings, for an app that does not compose it. */
export const localConfig: Readonly<Record<string, unknown>> = {
  accounts: portalConfig.accounts,
  auth: portalConfig.auth,
};
