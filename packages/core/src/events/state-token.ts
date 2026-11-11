/** The opaque token `v2.<epoch>.<position>.<scope>.<check>` of section 15.2.6 (the check covers the epoch, the position and the scope, sealed under the scope's token key): JMAP state, live stream tokens, the sync cursor. */
export type StateToken = string & { readonly __stateToken: true };
