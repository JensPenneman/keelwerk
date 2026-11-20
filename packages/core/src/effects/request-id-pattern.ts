/** A request id as the invoker mints it: a UUID in its canonical lower-case form. */
export const requestIdPattern: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
