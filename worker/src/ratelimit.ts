// Request limits with the Workers rate limiting binding (wrangler.json,
// `ratelimits`). The zone is on the Free plan, whose single WAF rate limiting
// rule is already used elsewhere, so the limits live here.
//
// Counters are per Cloudflare location and eventually consistent: they stop
// floods and scripts, not a careful attacker spread over many locations. The
// daily upload cap in D1 (src/photos.ts) is the exact one.

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface RateEnv {
  UPLOAD_LIMIT?: RateLimiter;   // per signed-in user
  LOGIN_LIMIT?: RateLimiter;    // per IP, OSM sign-in start and callback
  SEARCH_LIMIT?: RateLimiter;   // per IP, text and nearby search (page and API)
}

// Missing binding (tests, local dev without it) or a limiter error: let the
// request through. A broken limiter must not take the site down.
export async function allowed(limiter: RateLimiter | undefined, key: string | null): Promise<boolean> {
  if (!limiter || !key) return true;
  try {
    return (await limiter.limit({ key })).success;
  } catch {
    return true;
  }
}

export const clientIp = (request: Request) => request.headers.get('cf-connecting-ip');

// Seconds until a 60 s window has surely passed.
export const RETRY_AFTER = '60';
