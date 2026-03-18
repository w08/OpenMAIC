/**
 * Shared model resolution utilities for API routes.
 *
 * Extracts the repeated parseModelString → resolveApiKey → resolveBaseUrl →
 * resolveProxy → getModel boilerplate into a single call.
 */

import type { NextRequest } from 'next/server';
import { getModel, parseModelString, type ModelWithInfo } from '@/lib/ai/providers';
import { resolveApiKey, resolveBaseUrl, resolveProxy } from '@/lib/server/provider-config';
<<<<<<< HEAD
import {
  resolveCopilotToken,
  clearCopilotTokenCache,
  refreshGithubAccessToken,
} from '@/lib/server/copilot-token';
import {
  loadCopilotGithubToken,
  loadCopilotRefreshToken,
  updateCopilotGithubToken,
  clearCopilotGithubToken,
} from '@/lib/server/copilot-token-store';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';
import { createLogger } from '@/lib/logger';

const log = createLogger('ResolveModel');
=======
import { resolveCopilotToken } from '@/lib/server/copilot-token';
import { loadCopilotGithubToken } from '@/lib/server/copilot-token-store';
>>>>>>> 49e8555 (支持保存token到本地的功能，以适配openClaw)

export interface ResolvedModel extends ModelWithInfo {
  /** Original model string (e.g. "openai/gpt-4o-mini") */
  modelString: string;
}

/**
 * Resolve a language model from explicit parameters.
 *
 * Use this when model config comes from the request body.
 */
export async function resolveModel(params: {
  modelString?: string;
  apiKey?: string;
  baseUrl?: string;
  providerType?: string;
  requiresApiKey?: boolean;
}): Promise<ResolvedModel> {
  const modelString = params.modelString || process.env.DEFAULT_MODEL || 'gpt-4o-mini';
  const { providerId, modelId } = parseModelString(modelString);
  const clientBaseUrl = params.baseUrl || undefined;
  if (clientBaseUrl && process.env.NODE_ENV === 'production') {
    const ssrfError = validateUrlForSSRF(clientBaseUrl);
    if (ssrfError) {
      throw new Error(ssrfError);
    }
  }

  let apiKey = clientBaseUrl
    ? params.apiKey || ''
    : resolveApiKey(providerId, params.apiKey || '');
  let baseUrl = clientBaseUrl ? clientBaseUrl : resolveBaseUrl(providerId, params.baseUrl);
  const proxy = resolveProxy(providerId);

  // GitHub Copilot: if no API key from env/config, try locally persisted token
<<<<<<< HEAD
  let usingPersistedToken = false;
=======
>>>>>>> 49e8555 (支持保存token到本地的功能，以适配openClaw)
  if (providerId === 'github-copilot' && !apiKey) {
    const savedToken = await loadCopilotGithubToken();
    if (savedToken) {
      apiKey = savedToken;
<<<<<<< HEAD
      usingPersistedToken = true;
=======
>>>>>>> 49e8555 (支持保存token到本地的功能，以适配openClaw)
    }
  }

  // GitHub Copilot: exchange GitHub token for Copilot runtime token
  if (providerId === 'github-copilot' && apiKey) {
    try {
      const copilotResult = await resolveCopilotToken(apiKey);
      apiKey = copilotResult.token;
      if (!params.baseUrl) {
        baseUrl = copilotResult.baseUrl;
      }
    } catch (error) {
      // If using persisted token and exchange failed, try auto-refresh
      if (usingPersistedToken) {
        log.warn('Copilot token exchange failed, attempting refresh...', error);
        clearCopilotTokenCache(apiKey);
        const refreshToken = await loadCopilotRefreshToken();
        if (refreshToken) {
          const refreshResult = await refreshGithubAccessToken(refreshToken);
          if (refreshResult) {
            log.info('GitHub access token refreshed successfully via refresh token');
            // Save the new tokens
            await updateCopilotGithubToken(
              refreshResult.accessToken,
              refreshResult.refreshToken,
              refreshResult.refreshTokenExpiresIn,
            );
            // Retry the exchange with the new access token
            const copilotResult = await resolveCopilotToken(refreshResult.accessToken);
            apiKey = copilotResult.token;
            if (!params.baseUrl) {
              baseUrl = copilotResult.baseUrl;
            }
          } else {
            // Refresh token also failed — clear everything
            log.error('Refresh token also invalid, clearing stored tokens');
            await clearCopilotGithubToken();
            throw new Error(
              'GitHub Copilot token expired and refresh failed. Please re-login via Settings.',
            );
          }
        } else {
          // No refresh token available — clear the expired access token
          log.error('No refresh token available, clearing expired access token');
          await clearCopilotGithubToken();
          throw new Error(
            'GitHub Copilot token expired and no refresh token available. Please re-login via Settings.',
          );
        }
      } else {
        throw error;
      }
    }
  }

  const { model, modelInfo } = getModel({
    providerId,
    modelId,
    apiKey,
    baseUrl,
    proxy,
    providerType: params.providerType as 'openai' | 'anthropic' | 'google' | undefined,
    requiresApiKey: params.requiresApiKey,
  });

  return { model, modelInfo, modelString };
}

/**
 * Resolve a language model from standard request headers.
 *
 * Reads: x-model, x-api-key, x-base-url, x-provider-type, x-requires-api-key
 */
export async function resolveModelFromHeaders(req: NextRequest): Promise<ResolvedModel> {
  return resolveModel({
    modelString: req.headers.get('x-model') || undefined,
    apiKey: req.headers.get('x-api-key') || undefined,
    baseUrl: req.headers.get('x-base-url') || undefined,
    providerType: req.headers.get('x-provider-type') || undefined,
    requiresApiKey: req.headers.get('x-requires-api-key') === 'true' ? true : undefined,
  });
}
