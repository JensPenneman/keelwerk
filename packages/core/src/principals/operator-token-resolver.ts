import type { ControlStore } from '../control/control-store.ts';
import { findControlRows } from '../control/find-control-rows.ts';
import { operatorTokenPrefix } from '../core-module/operator-token-prefix.ts';
import { errors } from '../errors/errors.ts';
import { parseSealedValueText } from '../keys/parse-sealed-value-text.ts';
import { parseToken } from '../keys/parse-token.ts';
import type { OperatorPrincipal } from './operator-principal.ts';

function instantOf(value: unknown): Temporal.Instant | undefined {
  return value instanceof Temporal.Instant ? value : undefined;
}

/** Turns a presented operator token into the operator it stands for. */
export type OperatorTokenResolver = (token: string) => Promise<OperatorPrincipal>;

/**
 * The resolver of operator tokens (section 3.5, S-32): finds the `core.operatorToken` row by the
 * token's public id, opens its sealed verifier, and compares the presented secret through the key
 * service under the deployment key, in constant time. An unknown, malformed, expired or revoked
 * token is one `unauthenticated` error, so the answer reveals nothing about which. Each accepted
 * use is logged with the token's id and label (the audit of use).
 */
export function createOperatorTokenResolver(store: ControlStore): OperatorTokenResolver {
  const refused = () => errors.unauthenticated('The operator token was not accepted.');
  return async (token) => {
    const parsed = parseToken(token);
    if (parsed === undefined || parsed.prefix !== operatorTokenPrefix) throw refused();
    const [row] = await findControlRows(store, 'core.operatorToken', { publicId: parsed.publicId });
    if (row === undefined) throw refused();
    const sealed = parseSealedValueText(String(row.verifier));
    const opened =
      sealed === undefined ? undefined : await store.read((unit) => unit.keys.openValue(sealed));
    if (opened === undefined) throw refused();
    const verified = await store.keys.verify(
      { level: 'deployment' },
      token,
      new TextDecoder().decode(opened),
    );
    const now = store.clock.now();
    const expiresAt = instantOf(row.expiresAt);
    if (
      !verified ||
      expiresAt === undefined ||
      Temporal.Instant.compare(expiresAt, now) <= 0 ||
      (row.revokedAt !== undefined && row.revokedAt !== null)
    ) {
      throw refused();
    }
    const id = String(row.id);
    store.log.info('operator token used', { tokenId: id, label: String(row.label) });
    return {
      kind: 'operator',
      id,
      scope: { backend: null, tenant: null },
      claims: { label: String(row.label) },
      roles: [],
      memberships: [],
      via: 'core.operatorToken',
      ref: { resolver: 'core.operatorToken', principalId: id },
      expiresAt,
    };
  };
}
