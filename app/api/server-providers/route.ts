import {
  getServerProviders,
  getServerTTSProviders,
  getServerASRProviders,
  getServerPDFProviders,
  getServerImageProviders,
  getServerVideoProviders,
  getServerWebSearchProviders,
} from '@/lib/server/provider-config';
import { hasSavedCopilotToken } from '@/lib/server/copilot-token-store';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';

const log = createLogger('ServerProviders');

export async function GET() {
  try {
    const providers = getServerProviders();

    // If a saved Copilot token exists, include github-copilot as a server-configured provider
    // so the client auto-selects it on first load
    if (!providers['github-copilot']) {
      const hasCopilotToken = await hasSavedCopilotToken();
      if (hasCopilotToken) {
        providers['github-copilot'] = {};
      }
    }

    return apiSuccess({
      providers,
      tts: getServerTTSProviders(),
      asr: getServerASRProviders(),
      pdf: getServerPDFProviders(),
      image: getServerImageProviders(),
      video: getServerVideoProviders(),
      webSearch: getServerWebSearchProviders(),
    });
  } catch (error) {
    log.error('Error fetching server providers:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
