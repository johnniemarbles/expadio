/**
 * Client-side credential wrapping (design §2.2, browser half).
 *
 * Mirrors `WrappingKeyStore.unwrap` in @expadio/credential-custody exactly:
 *   - ECDH on P-256 with the server's published public key
 *   - Concat-KDF (single SHA-256 round): sha256( 0x00000001 || Z || label )
 *     where label = "ECDH-ES+A256GCM"
 *   - AES-256-GCM, 12-byte IV, 128-bit tag, no additional data
 *
 * The secret is wrapped before it leaves the tab; only the envelope travels to
 * /custody/credentials, and nothing in the envelope is readable without the
 * private half the custody service never releases. If these steps drift from
 * the server, `unwrap` fails closed with CUSTODY_UNWRAP_FAILED.
 */

export interface PublishedWrappingKey {
  kid: string;
  publicJwk: { kty: "EC"; crv: "P-256"; x: string; y: string };
  expiresAt: string;
  algorithm: "ECDH-ES+A256GCM";
}

export interface WrappedSecretEnvelope {
  kid: string;
  epk: string;
  iv: string;
  ct: string;
  tag: string;
}

function b64u(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function wrapSecret(
  published: PublishedWrappingKey,
  plaintext: string,
): Promise<WrappedSecretEnvelope> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("This browser does not expose Web Crypto; credentials cannot be wrapped securely.");
  }

  // Server's public key, and a fresh ephemeral pair for this one envelope.
  const serverKey = await subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: published.publicJwk.x, y: published.publicJwk.y, ext: true },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ephemeral = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);

  // epk: sender's ephemeral public key as the raw uncompressed point (0x04||X||Y).
  const epkRaw = new Uint8Array(await subtle.exportKey("raw", ephemeral.publicKey));

  // Shared secret Z = the 32-byte X coordinate (matches node ecdh.computeSecret).
  const shared = new Uint8Array(
    await subtle.deriveBits({ name: "ECDH", public: serverKey }, ephemeral.privateKey, 256),
  );

  // Concat-KDF single round → 32-byte AES key.
  const label = new TextEncoder().encode(published.algorithm);
  const kdfInput = new Uint8Array(4 + shared.length + label.length);
  kdfInput.set([0, 0, 0, 1], 0);
  kdfInput.set(shared, 4);
  kdfInput.set(label, 4 + shared.length);
  const aesRaw = new Uint8Array(await subtle.digest("SHA-256", kdfInput));
  const aesKey = await subtle.importKey("raw", aesRaw, { name: "AES-GCM" }, false, ["encrypt"]);

  // AES-256-GCM. WebCrypto appends the 16-byte tag to the ciphertext.
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await subtle.encrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      aesKey,
      new TextEncoder().encode(plaintext),
    ),
  );
  const ct = sealed.slice(0, sealed.length - 16);
  const tag = sealed.slice(sealed.length - 16);

  return {
    kid: published.kid,
    epk: b64u(epkRaw),
    iv: b64u(iv),
    ct: b64u(ct),
    tag: b64u(tag),
  };
}
