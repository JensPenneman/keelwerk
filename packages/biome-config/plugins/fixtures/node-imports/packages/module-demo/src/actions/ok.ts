import { defineAction } from '@keelwerk/core';
import { sha256 } from '@keelwerk/core/crypto';

export const used = [defineAction, sha256];
