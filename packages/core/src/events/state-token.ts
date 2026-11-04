/** The opaque token `v1.<epoch>.<position>.<scope>.<check>` of section 15.2.6: JMAP state, live stream tokens, the sync cursor. */
export type StateToken = string & { readonly __stateToken: true };
