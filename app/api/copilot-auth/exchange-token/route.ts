/**
 * POST /api/copilot-auth/exchange-token
 *
 * Exchanges a GitHub access token for a Copilot runtime token.
 * This is called before model requests to get the token that
 * authenticates against the Copilot model API.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveCopilotToken } from '@/lib/server/copilot-token';
import { createLogger } from '@/lib/logger';

const log = createLogger('CopilotAuth:ExchangeToken');

export async function POST(req: NextRequest) {
  try {
    const { github_token } = await req.json();

    if (!github_token || typeof github_token !== 'string') {
      return NextResponse.json({ error: 'github_token is required' }, { status: 400 });
    }

    const result = await resolveCopilotToken(github_token);

    return NextResponse.json({
      token: result.token,
      expires_at: result.expiresAt,
      base_url: result.baseUrl,
    });
  } catch (error) {
    log.error('Token exchange error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
