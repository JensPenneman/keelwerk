/**
 * A valid Argon2id hash (current parameters) of a password nobody has, for verifying an unknown
 * identifier at the same cost as a known one, so timing does not reveal which identifiers exist (17.2.2).
 */
export const dummyVerifier =
  '$argon2id$v=19$m=19456,t=2,p=1$a2VlbHdlcmstZHVtbXktMQ$dBIfJjNgWynIjnORc/hI1iAlmHJt/uL6g7DG2/bFyd8';
