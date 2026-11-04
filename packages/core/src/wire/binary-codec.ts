import { decodeBase64Url } from '../fields/decode-base64-url.ts';
import { encodeBase64Url } from './encode-base64-url.ts';

/** The codec of `binary` fields: bytes and unpadded base64url strings (section 16.2.3). */
export const binaryCodec: {
  /** Bytes to their wire form. */
  toWire(bytes: Uint8Array): string;
  /** The bytes of a base64url wire string, or `undefined` when it is malformed. */
  fromWire(text: string): Uint8Array | undefined;
} = {
  toWire: (bytes) => encodeBase64Url(bytes),
  fromWire: (text) => decodeBase64Url(text),
};
