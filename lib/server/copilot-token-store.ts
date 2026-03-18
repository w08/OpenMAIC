/**
 * Server-side GitHub Copilot Token Persistence
 *
 * Saves the GitHub access token to a local JSON file so that server-side
 * code (e.g. /api/generate-classroom) can use GitHub Copilot as a provider
 * even when no GITHUB_COPILOT_API_KEY is set in .env.local.
 *
 * File location: data/copilot-token.json
 *
 * The stored token is the GitHub access token (ghu_...), NOT the Copilot
 * runtime token. The runtime token exchange + caching is handled by
 * copilot-token.ts as usual.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { createLogger } from '@/lib/logger';

const log = createLogger('CopilotTokenStore');

const TOKEN_FILE = path.join(process.cwd(), 'data', 'copilot-token.json');

interface StoredToken {
  /** GitHub access token (ghu_...) */
  githubToken: string;
  /** GitHub refresh token for auto-renewal */
  refreshToken?: string;
  /** When the refresh token expires (ISO string) */
  refreshTokenExpiresAt?: string;
  /** When the token was saved (ISO string) */
  savedAt: string;
}

/** In-memory cache to avoid repeated file reads */
let cachedToken: StoredToken | null | undefined; // undefined = not loaded yet

async function ensureDataDir() {
  await fs.mkdir(path.dirname(TOKEN_FILE), { recursive: true });
}

/**
 * Save a GitHub access token to the local file system.
 */
export async function saveCopilotGithubToken(
  githubToken: string,
  refreshToken?: string,
  refreshTokenExpiresIn?: number,
): Promise<void> {
  await ensureDataDir();
  const data: StoredToken = {
    githubToken,
    refreshToken,
    refreshTokenExpiresAt: refreshTokenExpiresIn
      ? new Date(Date.now() + refreshTokenExpiresIn * 1000).toISOString()
      : undefined,
    savedAt: new Date().toISOString(),
  };
  const tempFile = `${TOKEN_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tempFile, TOKEN_FILE);
  cachedToken = data;
  log.info('Copilot GitHub token saved to local file');
}

/**
 * Load the saved GitHub access token from the local file system.
 * Returns null if no token is saved or the file is corrupt.
 */
export async function loadCopilotGithubToken(): Promise<string | null> {
  // Use in-memory cache if available
  if (cachedToken !== undefined) {
    return cachedToken?.githubToken ?? null;
  }

  try {
    const content = await fs.readFile(TOKEN_FILE, 'utf-8');
    const data = JSON.parse(content) as StoredToken;
    if (data.githubToken && typeof data.githubToken === 'string') {
      cachedToken = data;
      return data.githubToken;
    }
    cachedToken = null;
    return null;
  } catch {
    // File doesn't exist or is corrupt
    cachedToken = null;
    return null;
  }
}

/**
 * Clear the saved token (logout from server-side persistence).
 */
export async function clearCopilotGithubToken(): Promise<void> {
  cachedToken = null;
  try {
    await fs.unlink(TOKEN_FILE);
    log.info('Copilot GitHub token cleared from local file');
  } catch {
    // File may not exist — that's fine
  }
}

/**
 * Update the cached token (e.g. after re-login).
 * This also updates the file on disk.
 */
export async function updateCopilotGithubToken(
  githubToken: string,
  refreshToken?: string,
  refreshTokenExpiresIn?: number,
): Promise<void> {
  // Preserve existing refresh token if not provided
  if (!refreshToken && cachedToken?.refreshToken) {
    refreshToken = cachedToken.refreshToken;
    // Keep existing expiry if we have one and no new one
    if (!refreshTokenExpiresIn && cachedToken.refreshTokenExpiresAt) {
      const existingExpiry = new Date(cachedToken.refreshTokenExpiresAt).getTime();
      refreshTokenExpiresIn = Math.max(0, Math.floor((existingExpiry - Date.now()) / 1000));
    }
  }
  await saveCopilotGithubToken(githubToken, refreshToken, refreshTokenExpiresIn);
}

/**
 * Load the stored refresh token.
 * Returns null if no refresh token is saved or it has expired.
 */
export async function loadCopilotRefreshToken(): Promise<string | null> {
  // Ensure cache is loaded
  await loadCopilotGithubToken();

  if (!cachedToken?.refreshToken) return null;

  // Check if refresh token has expired
  if (cachedToken.refreshTokenExpiresAt) {
    const expiresAt = new Date(cachedToken.refreshTokenExpiresAt).getTime();
    if (Date.now() >= expiresAt) {
      log.warn('Stored Copilot refresh token has expired');
      return null;
    }
  }

  return cachedToken.refreshToken;
}

/**
 * Check if a saved token exists (without returning the value).
 */
export async function hasSavedCopilotToken(): Promise<boolean> {
  const token = await loadCopilotGithubToken();
  return token !== null;
}
