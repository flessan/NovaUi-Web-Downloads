/*
 * Nova UI · shared GitHub Releases proxy for Cloudflare Pages.
 *
 * Cache release metadata at the edge so every visitor does not spend a
 * separate unauthenticated GitHub REST API request. Keep a longer-lived
 * stale copy for rate-limit and upstream failure fallback.
 *
 * Optional Pages secret: GITHUB_TOKEN (fine-grained token with public
 * repository metadata/read access). Edge caching is still used without it.
 */

const ALLOWED_REPOSITORIES = new Set([
  'DANZGAME-GD/NovaUI',
  'DANZGAME-GD/NovaUI-exten',
]);

const FRESH_TTL = 5 * 60;
const STALE_TTL = 7 * 24 * 60 * 60;

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

function tagged(response, source, { noStore = false } = {}) {
  const headers = new Headers(response.headers);
  headers.set('X-Nova-Release-Cache', source);
  if (noStore) headers.set('Cache-Control', 'no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function cacheKey(origin, namespace, owner, repo, perPage) {
  const url = new URL('/__nova_cache/' + namespace, origin);
  url.searchParams.set('owner', owner);
  url.searchParams.set('repo', repo);
  url.searchParams.set('per_page', String(perPage));
  return new Request(url.toString(), { method: 'GET' });
}

function isRateLimited(response, payloadText) {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  if (response.headers.get('x-ratelimit-remaining') === '0') return true;
  return /rate.?limit|secondary rate limit|abuse detection/i.test(payloadText || '');
}

function isTransientFailure(response) {
  return response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const owner = (url.searchParams.get('owner') || '').trim();
  const repo = (url.searchParams.get('repo') || '').trim();
  const fullName = owner + '/' + repo;
  const perPageValue = Number.parseInt(url.searchParams.get('per_page') || '100', 10);
  const perPage = Number.isFinite(perPageValue) ? Math.min(100, Math.max(1, perPageValue)) : 100;
  const force = url.searchParams.get('refresh') === '1';

  if (!ALLOWED_REPOSITORIES.has(fullName)) {
    return json({ message: 'This release repository is not allowed.' }, 400);
  }

  const cache = caches.default;
  const freshKey = cacheKey(url.origin, 'fresh', owner, repo, perPage);
  const staleKey = cacheKey(url.origin, 'stale', owner, repo, perPage);

  let stale = null;
  try {
    stale = await cache.match(staleKey);
    if (!force) {
      const fresh = await cache.match(freshKey);
      if (fresh) return tagged(fresh, 'HIT');
    }
  } catch {
    // Continue upstream when the edge cache is unavailable.
  }

  const upstreamUrl = 'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' +
    encodeURIComponent(repo) + '/releases?per_page=' + perPage;
  const headers = new Headers({
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Nova-UI-Releases-Proxy',
  });
  if (env.GITHUB_TOKEN) headers.set('Authorization', 'Bearer ' + env.GITHUB_TOKEN);

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, { headers });
  } catch {
    if (stale) return tagged(stale, 'STALE', { noStore: true });
    return json({ message: 'GitHub is temporarily unreachable and no cached releases are available yet.' }, 503, {
      'Retry-After': '60',
    });
  }

  const payloadText = await upstream.text();
  if (!upstream.ok) {
    if ((isRateLimited(upstream, payloadText) || isTransientFailure(upstream)) && stale) {
      return tagged(stale, 'STALE', { noStore: true });
    }

    if (isRateLimited(upstream, payloadText)) {
      return json({ message: 'GitHub API rate limit reached. A cached release copy is not available yet.' }, 429, {
        'Retry-After': upstream.headers.get('retry-after') || '60',
      });
    }

    return json({
      message: 'GitHub could not load releases (' + upstream.status + ').',
    }, upstream.status === 404 ? 404 : 502);
  }

  let releases;
  try {
    releases = JSON.parse(payloadText);
  } catch {
    if (stale) return tagged(stale, 'STALE', { noStore: true });
    return json({ message: 'GitHub returned invalid release data.' }, 502);
  }

  if (!Array.isArray(releases)) {
    if (stale) return tagged(stale, 'STALE', { noStore: true });
    return json({ message: 'GitHub returned an unexpected release response.' }, 502);
  }

  const freshResponse = new Response(JSON.stringify(releases), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=' + FRESH_TTL,
      'X-Content-Type-Options': 'nosniff',
    },
  });
  const staleResponse = new Response(JSON.stringify(releases), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=' + STALE_TTL,
      'X-Content-Type-Options': 'nosniff',
    },
  });

  try {
    await Promise.all([
      cache.put(freshKey, freshResponse.clone()),
      cache.put(staleKey, staleResponse),
    ]);
  } catch {
    // The API response remains usable if edge cache storage is unavailable.
  }

  return tagged(freshResponse, 'MISS');
}
