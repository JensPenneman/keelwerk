import type { WireError } from '@keelwerk/core';

/** The error shape of the router: tRPC's own members and the taxonomy's wire error as `data.keelwerk`. */
export interface TrpcErrorShape {
  message: string;
  code: number;
  data: { code: string; httpStatus: number; path?: string; keelwerk: WireError };
}
