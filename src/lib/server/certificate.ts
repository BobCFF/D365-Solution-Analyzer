import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, sign, X509Certificate } from "node:crypto";

/**
 * Certificate credentials for Microsoft Entra (client assertion, RFC 7523). The app generates the RSA key pair itself:
 * the private key is sealed straight into the database and never shown or sent anywhere; only the PUBLIC certificate is
 * handed to the user to upload to the app registration. Node cannot create X.509 certificates, so a minimal
 * self-signed v3 certificate is encoded here (DER) and verified in tests with Node's own X509Certificate parser.
 */
const b64u = (b: Buffer) => b.toString("base64url");
const CERT_DAYS = 730;

/* ---- minimal DER encoder ---- */
const der = (tag: number, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts), n = body.length;
  const len = n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 255];
  return Buffer.concat([Buffer.from([tag, ...len]), body]);
};
const oid = (dotted: string) => {
  const p = dotted.split(".").map(Number);
  const out: number[] = [p[0] * 40 + p[1]];
  for (const v of p.slice(2)) { const s = [v & 127]; for (let x = v >> 7; x > 0; x >>= 7) s.unshift((x & 127) | 128); out.push(...s); }
  return der(0x06, Buffer.from(out));
};
const SHA256_RSA = der(0x30, oid("1.2.840.113549.1.1.11"), der(0x05));
const utcTime = (d: Date) => der(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, "").slice(2, 14) + "Z"));
const name = (cn: string) => der(0x30, der(0x31, der(0x30, oid("2.5.4.3"), der(0x0c, Buffer.from(cn)))));
const pem = (label: string, buf: Buffer) => `-----BEGIN ${label}-----\n${buf.toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END ${label}-----\n`;

export interface GeneratedCertificate { privateKeyPem: string; certificatePem: string }

/** New RSA-2048 key pair + self-signed certificate (valid ~2 years) named after the app registration. */
export function generateCertificate(commonName: string, now = new Date()): GeneratedCertificate {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const serial = randomBytes(16); serial[0] = (serial[0] & 0x7f) | 0x01;
  const notAfter = new Date(now.getTime() + CERT_DAYS * 86_400_000);
  const cn = commonName.replace(/[^\x20-\x7e]/g, "").slice(0, 60) || "D365 Solution Analyzer";
  const tbs = der(0x30,
    der(0xa0, der(0x02, Buffer.from([2]))), der(0x02, serial), SHA256_RSA,
    name(cn), der(0x30, utcTime(now), utcTime(notAfter)), name(cn),
    publicKey.export({ type: "spki", format: "der" }) as Buffer);
  const signature = sign("sha256", tbs, privateKey);
  const cert = der(0x30, tbs, SHA256_RSA, der(0x03, Buffer.concat([Buffer.from([0]), signature])));
  return { privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string, certificatePem: pem("CERTIFICATE", cert) };
}

export interface CertificateInfo { thumbprint: string; thumbprintSha256: string; expiresAt: string; subject: string }
/** Public facts about a stored certificate (safe to show). */
export function inspectCertificate(certificatePem: string): CertificateInfo {
  const c = new X509Certificate(certificatePem);
  return { thumbprint: c.fingerprint.replace(/:/g, "").toLowerCase(), thumbprintSha256: c.fingerprint256.replace(/:/g, "").toLowerCase(), expiresAt: new Date(c.validTo).toISOString(), subject: c.subject.replace(/^CN=/, "") };
}

/** True if the private key belongs to the certificate (guards against a mismatched pair). */
export function keyMatchesCertificate(privateKeyPem: string, certificatePem: string): boolean {
  const mine = createPublicKey(createPrivateKey(privateKeyPem)).export({ type: "spki", format: "der" }) as Buffer;
  return mine.equals(new X509Certificate(certificatePem).publicKey.export({ type: "spki", format: "der" }) as Buffer);
}

/** The signed JWT Entra accepts instead of a client secret (valid 10 minutes, single use jti). */
export function buildClientAssertion(o: { clientId: string; audience: string; privateKeyPem: string; certificatePem: string; now?: number }): string {
  const c = new X509Certificate(o.certificatePem);
  const sha1 = Buffer.from(c.fingerprint.replace(/:/g, ""), "hex"), sha256 = Buffer.from(c.fingerprint256.replace(/:/g, ""), "hex");
  const t = Math.floor((o.now ?? Date.now()) / 1000);
  const header = b64u(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", x5t: b64u(sha1), "x5t#S256": b64u(sha256) })));
  const payload = b64u(Buffer.from(JSON.stringify({ aud: o.audience, iss: o.clientId, sub: o.clientId, jti: randomUUID(), nbf: t, iat: t, exp: t + 600 })));
  const sig = sign("sha256", Buffer.from(`${header}.${payload}`), createPrivateKey(o.privateKeyPem));
  return `${header}.${payload}.${b64u(sig)}`;
}
