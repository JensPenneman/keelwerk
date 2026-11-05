type Values = Readonly<Record<string, unknown>>;

/** The values with the undefined ones left out, frozen. */
export function definedValues(values: Values): Values {
  return Object.freeze(
    Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)),
  );
}
