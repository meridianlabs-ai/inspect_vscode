import { randomBytes } from "crypto";

const kNonceChars =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const kNonceLength = 64;

// Generates a cryptographically strong nonce for use in webview
// Content-Security-Policy headers. Math.random() is not a CSPRNG and its
// output is predictable, which would undermine the nonce's purpose of
// authorizing only the scripts we emit. We draw from crypto.randomBytes and
// map onto an alphanumeric alphabet using rejection sampling to avoid the
// modulo bias that would skew the character distribution.
export function getNonce() {
  // Largest multiple of the alphabet size that fits in a byte; bytes at or
  // above this threshold are rejected so every character is equally likely.
  const limit = Math.floor(256 / kNonceChars.length) * kNonceChars.length;

  let text = "";
  while (text.length < kNonceLength) {
    for (const byte of randomBytes(kNonceLength)) {
      if (byte < limit) {
        text += kNonceChars.charAt(byte % kNonceChars.length);
        if (text.length === kNonceLength) {
          break;
        }
      }
    }
  }
  return text;
}
