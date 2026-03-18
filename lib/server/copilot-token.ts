/**
 * GitHub Copilot Token Management
 *
 * Handles the two-step authentication flow:
 * 1. GitHub Device Flow → GitHub access token (done by the user in settings UI)
 * 2. GitHub access token → Copilot runtime token (done server-side before model calls)
 *
 * The Copilot runtime token is what actually authenticates requests to the
 * Copilot API (https://api.individual.githubcopilot.com).
 */

import { createLogger } from '@/lib/logger';

const log = createLogger('CopilotToken');

const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';
const DEFAULT_COPILOT_API_BASE_URL = 'https://api.individual.githubcopilot.com';
const GITHUB_REFRESH_URL = 'https://github.com/login/oauth/access_token';
const CLIENT_ID = 'Iv1.b507a08c87ecfe98';

/** Refresh 5 minutes before expiry */
const REFRESH_MARGIN_MS = 300 * 1_000;

export interface CopilotTokenResult {
  /** The Copilot runtime token for API calls */
  token: string;
  /** When the token expires (epoch ms) */
  expiresAt: number;
  /** The resolved base URL from the token's proxy-ep field, or default */
  baseUrl: string;
}

/** In-memory cache of resolved Copilot tokens keyed by GitHub token hash */
const tokenCache = new Map<string, CopilotTokenResult>();

/**
 * Simple hash of a token string for use as cache key.
 * Not cryptographic — just for deduplication.
 */
function hashToken(token: string): string {
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    const char = token.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash.toString(36);
}

/**
 * Parse the expires_at field from the Copilot token response.
 */
function parseExpiresAt(expiresAt: unknown): number {
  if (typeof expiresAt === 'number' && Number.isFinite(expiresAt)) {
    // Could be seconds or milliseconds
    return expiresAt > 1e10 ? expiresAt : expiresAt * 1_000;
  }
  if (typeof expiresAt === 'string' && expiresAt.trim().length > 0) {
    const parsed = Number.parseInt(expiresAt, 10);
    if (!Number.isFinite(parsed)) {
      throw new Error('Copilot token response has invalid expires_at');
    }
    return parsed > 1e10 ? parsed : parsed * 1_000;
  }
  throw new Error('Copilot token response missing expires_at');
}

/**
 * Derive the API base URL from the Copilot runtime token.
 * Some tokens contain a proxy-ep field that indicates a different endpoint.
 */
function deriveCopilotBaseUrl(token: string): string {
  const match = token.match(/(?:^|;)\s*proxy-ep=([^;\s]+)/i);
  if (!match?.[1]) return DEFAULT_COPILOT_API_BASE_URL;

  const host = match[1].trim().replace(/^https?:\/\//, '').replace(/^proxy\./i, 'api.');
  return host ? `https://${host}` : DEFAULT_COPILOT_API_BASE_URL;
}

/**
 * Exchange a GitHub access token for a Copilot runtime token.
 *
 * Uses an in-memory cache with a 5-minute refresh margin.
 * This should be called server-side before making model API calls.
 */
export async function resolveCopilotToken(githubToken: string): Promise<CopilotTokenResult> {
  const cacheKey = hashToken(githubToken);

  // Check cache
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    log.debug('Using cached Copilot token');
    return cached;
  }

  log.info('Exchanging GitHub token for Copilot runtime token...');

  const res = await fetch(COPILOT_TOKEN_URL, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${githubToken}`,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Copilot token exchange failed: HTTP ${res.status}${body ? ` - ${body}` : ''}`,
    );
  }

  const json = (await res.json()) as Record<string, unknown>;

  if (typeof json.token !== 'string' || json.token.trim().length === 0) {
    throw new Error('Copilot token response missing token');
  }

  const expiresAt = parseExpiresAt(json.expires_at);
  const token = json.token as string;
  const baseUrl = deriveCopilotBaseUrl(token);

  const result: CopilotTokenResult = { token, expiresAt, baseUrl };

  // Update cache
  tokenCache.set(cacheKey, result);

  const remainingSec = Math.max(0, Math.floor((expiresAt - Date.now()) / 1_000));
  log.info(`Copilot token acquired, expires in ${remainingSec}s`);

  return result;
}

/**
 * Clear the cached Copilot token for a given GitHub token.
 */
export function clearCopilotTokenCache(githubToken?: string): void {
  if (githubToken) {
    tokenCache.delete(hashToken(githubToken));
  } else {
    tokenCache.clear();
  }
}

/**
 * Result of refreshing a GitHub access token using a refresh token.
 */
export interface GithubRefreshResult {
  /** New GitHub access token */
  accessToken: string;
  /** New refresh token (GitHub rotates them on each use) */
  refreshToken: string;
  /** Refresh token expiry in seconds */
  refreshTokenExpiresIn: number;
}

/**
 * Use a GitHub refresh token to obtain a new access token.
 *
 * GitHub rotates refresh tokens: each call returns a NEW refresh token
 * that must replace the old one.
 *
 * Returns null if the refresh token is invalid/expired (user must re-login).
 */
export async function refreshGithubAccessToken(
  refreshToken: string,
): Promise<GithubRefreshResult | null> {
  log.info('Attempting to refresh GitHub access token...');

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const res = await fetch(GITHUB_REFRESH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!res.ok) {
    log.error(`GitHub token refresh failed: HTTP ${res.status}`);
    return null;
  }

  const json = (await res.json()) as Record<string, unknown>;

  if (json.error) {
    log.error(`GitHub token refresh error: ${json.error} — ${json.error_description || ''}`);
    return null;
  }

  if (typeof json.access_token !== 'string' || !json.access_token) {
    log.error('GitHub token refresh response missing access_token');
    return null;
  }

  log.info('GitHub access token refreshed successfully');

  return {
    accessToken: json.access_token as string,
    refreshToken: (json.refresh_token as string) || refreshToken,
    refreshTokenExpiresIn: (json.refresh_token_expires_in as number) || 15_552_000,
  };
}
