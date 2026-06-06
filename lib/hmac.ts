import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verify an X-Signature: sha256=<hex> header against the raw request body.
 *
 * Uses constant-time comparison (timingSafeEqual) to prevent timing attacks.
 * Returns false for any malformed input rather than throwing.
 */
export function verifyHmacSignature(
  secret: string,
  rawBody: Buffer,
  signatureHeader: string
): boolean {
  const eqIdx = signatureHeader.indexOf("=");
  if (eqIdx === -1) return false;

  const scheme = signatureHeader.slice(0, eqIdx);
  const providedHex = signatureHeader.slice(eqIdx + 1);

  if (scheme !== "sha256") return false;

  const computed = createHmac("sha256", secret).update(rawBody).digest("hex");

  // SHA-256 always produces a 64-char hex digest.
  // Length mismatch = definitely wrong; reject before timingSafeEqual
  // (which requires equal-length buffers).
  if (providedHex.length !== computed.length) return false;

  try {
    return timingSafeEqual(
      Buffer.from(computed, "hex"),
      Buffer.from(providedHex, "hex")
    );
  } catch {
    // Invalid hex in either buffer — treat as bad signature
    return false;
  }
}
