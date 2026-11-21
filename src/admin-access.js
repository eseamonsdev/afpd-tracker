import { createRemoteJWKSet, jwtVerify } from "jose";

const ISSUER = "https://eseamonsdev.cloudflareaccess.com";
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/cdn-cgi/access/certs`));

const AUDIENCES = new Map([
  ["afpd-accountability.com", "3e8c6b505b5bea6291539b6874b42598ad888d299e55460a514f9cb62dd0224a"],
  ["staging-afpd-tracker.ericseamonsdeveloper.workers.dev", "803087bdac9585a7d9a88cbc04993d56c4f33d2bfeb7130e71671bda61121393"]
]);

export async function authenticatedAdminEmail(request, url, jwks = JWKS) {
  const audience = AUDIENCES.get(url.hostname);
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!audience || !token) return null;

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: ISSUER,
      audience,
      algorithms: ["RS256"]
    });
    return typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  } catch {
    return null;
  }
}
