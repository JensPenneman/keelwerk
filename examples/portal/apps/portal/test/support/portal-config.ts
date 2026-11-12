/**
 * The portal backend's configuration at creation: self-registration on and no API reference page.
 * The auth module keeps its default address limit: the test runtimes give every request its own
 * client address, so a scenario does not meet the limit (the limit itself is tested in
 * `address-limit.test.ts`).
 */
export const portalConfig: Readonly<Record<string, unknown>> = {
  accounts: { allowSelfRegistration: true },
  rest: { docs: false, cors: [] },
};

/** The same without the REST module's settings, for an app that does not compose it. */
export const localConfig: Readonly<Record<string, unknown>> = {
  accounts: portalConfig.accounts,
};
