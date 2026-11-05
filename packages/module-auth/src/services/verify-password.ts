import { defineService } from '@keelwerk/core';
import { authBase } from '../base.ts';
import { verifierOrDummy } from '../lib/verifier-or-dummy.ts';

export const verifyPassword = defineService(
  authBase,
  (own, verifier: string | undefined, password: string) =>
    own.compute.argon2idVerify(verifierOrDummy(verifier), password),
);
