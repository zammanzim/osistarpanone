// Generate VAPID P-256 keypair (base64url) untuk Web Push.
// Pakai: node tools/gen-vapid.cjs
// PUBLIC  -> js/config.js (VAPID_PUBLIC_KEY)
// PRIVATE -> wrangler secret put VAPID_PRIVATE (jangan commit!)
const c = require("crypto");
const { privateKey } = c.generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = privateKey.export({ format: "jwk" });
function b64uBuf(b) {
  return Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const uncomp = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64"), Buffer.from(jwk.y, "base64")]);
console.log("VAPID_PUBLIC_KEY  =", b64uBuf(uncomp));
console.log("VAPID_PRIVATE_KEY =", String(jwk.d).replace(/=+$/, ""));
console.log("\nLangkah:");
console.log("1. Tempel PUBLIC ke js/config.js");
console.log("2. cd worker && npx wrangler secret put VAPID_PUBLIC");
console.log("3. cd worker && npx wrangler secret put VAPID_PRIVATE");
console.log("4. cd worker && npx wrangler secret put VAPID_SUBJECT  # cth: mailto:osis@osistarpanone.my.id");
