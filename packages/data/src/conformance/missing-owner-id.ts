import { conformanceId } from './conformance-id.ts';

/** An id that no generated owner has, for rows whose reference dangles. */
export const missingOwnerId: string = conformanceId(999);
