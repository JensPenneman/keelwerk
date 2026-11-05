/** The key under which a decoded secret reference carries the module it was decoded for (section 6.6). Internal: parts cannot name it. */
export const secretRefOwner: unique symbol = Symbol('keelwerk.secretRefOwner');
