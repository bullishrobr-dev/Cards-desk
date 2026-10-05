import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { MiddlewareHandler } from 'hono';

/**
 * Cloudflare Access sits in front of the app; this middleware re-checks its signed JWT on every
 * API call (`ctx.access` is not passed to Workers that serve static assets, so the Worker
 * validates `Cf-Access-Jwt-Assertion` itself). Fails closed: in production a missing Access
 * configuration rejects every request rather than serving the API unprotected.
 */

export interface AccessIdentity {
  email: string | null;
  ownerId: string;
}

const jwksCache = new Map<string, JWTVerifyGetKey>();

function jwks(teamDomain: string): JWTVerifyGetKey {
  let set = jwksCache.get(teamDomain);
  if (!set) {
    set = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, set);
  }
  return set;
}

export function requireAccess(): MiddlewareHandler<{ Bindings: Env; Variables: { identity: AccessIdentity } }> {
  return async (c, next) => {
    const team = c.env.ACCESS_TEAM_DOMAIN;
    const aud = c.env.ACCESS_AUD;
    if (!team || !aud) {
      if (c.env.APP_ENV === 'production') return c.json({ error: 'Access is not configured' }, 503);
      c.set('identity', { email: 'dev@localhost', ownerId: 'owner_1' }); // local dev only
      return next();
    }
    const token = c.req.header('cf-access-jwt-assertion');
    if (!token) return c.json({ error: 'Not authenticated' }, 401);
    try {
      const { payload } = await jwtVerify(token, jwks(team), { issuer: `https://${team}`, audience: aud });
      // Single owner for now; personal tables already carry owner_id for when that changes.
      c.set('identity', { email: typeof payload.email === 'string' ? payload.email : null, ownerId: 'owner_1' });
    } catch {
      return c.json({ error: 'Invalid Access token' }, 403);
    }
    return next();
  };
}
