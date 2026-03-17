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
