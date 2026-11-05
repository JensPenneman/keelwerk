import { field, shape } from '@keelwerk/core';

export const config = shape({ allowSelfRegistration: field.boolean().default(false) });
