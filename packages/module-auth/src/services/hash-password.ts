import { defineService } from '@keelwerk/core';
import { authBase } from '../base.ts';

const saltBytes = 16;

export const hashPassword = defineService(authBase, function* (own, password: string) {
  const salt = yield* own.random(saltBytes);
  return yield* own.compute.argon2idHash(password, salt);
});
