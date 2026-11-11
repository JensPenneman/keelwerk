/**
 * A flag key `<module id>.<flag>`: the module id grammar of section 5.1, then one or more dot
 * segments of `[a-z][a-zA-Z0-9]*`. No key holds `@`, which a row's slot relies on (flagSlotOf).
 */
export const flagKeyPattern: RegExp =
  /^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*(?:\.[a-z][a-zA-Z0-9]*)+$/;
