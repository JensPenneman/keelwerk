import { parseTypeId } from '@keelwerk/core';
import { profileId } from './rest-kit.ts';

const uuid = parseTypeId(profileId, 'prof') ?? '';

export const profileRow: { id: string; name: string; version: number } = {
  id: uuid,
  name: 'Ada',
  version: 3,
};
