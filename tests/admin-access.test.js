import assert from "node:assert/strict";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { authenticatedAdminEmail } from "../src/admin-access.js";

const ISSUER = "https://eseamonsdev.cloudflareaccess.com";
const STAGING = "staging-afpd-tracker.ericseamonsdeveloper.workers.dev";
const STAGING_AUD = "803087bdac9585a7d9a88cbc04993d56c4f33d2bfeb7130e71671bda61121393";
const PRODUCTION_AUD = "3e8c6b505b5bea6291539b6874b42598ad888d299e55460a514f9cb62dd0224a";

test("admin requires a valid signed token for the exact hostname", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwks = createLocalJWKSet({ keys: [await exportJWK(publicKey)] });
  const url = new URL(`https://${STAGING}/admin/radio-ids/`);
  const sign = (audience, issuer = ISSUER, expiration = "1h") =>
    new SignJWT({ email: "EricSeamonsDeveloper@gmail.com" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expiration)
      .sign(privateKey);
  const request = token => new Request(url, {
    headers: token ? { "Cf-Access-Jwt-Assertion": token } : {}
  });

  assert.equal(await authenticatedAdminEmail(request(), url, jwks), null);
  const valid = await sign(STAGING_AUD);
  assert.equal(await authenticatedAdminEmail(request(valid), url, jwks), "ericseamonsdeveloper@gmail.com");
  assert.equal(await authenticatedAdminEmail(request(await sign(PRODUCTION_AUD)), url, jwks), null);
  assert.equal(await authenticatedAdminEmail(request(await sign(STAGING_AUD, "https://other.cloudflareaccess.com")), url, jwks), null);
  assert.equal(await authenticatedAdminEmail(request(await sign(STAGING_AUD, ISSUER, "0s")), url, jwks), null);
  assert.equal(await authenticatedAdminEmail(request(valid.slice(0, -2) + "ab"), url, jwks), null);
  assert.equal(await authenticatedAdminEmail(request(valid), new URL("https://other.example/admin/"), jwks), null);
});
