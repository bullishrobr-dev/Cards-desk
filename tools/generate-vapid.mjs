// Generates a VAPID key pair for Web Push. Run once: node tools/generate-vapid.mjs
// Then: wrangler secret put VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (and VAPID_SUBJECT=mailto:you@…).
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
console.log(`VAPID_PUBLIC_KEY=${b64url(raw)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
