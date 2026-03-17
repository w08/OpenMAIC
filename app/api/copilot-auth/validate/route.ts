/**
 * POST /api/copilot-auth/validate
 *
 * Validates a GitHub token by trying to exchange it for a Copilot token.
 * Returns success/failure without exposing the actual Copilot token.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveCopilotToken } from '@/lib/server/copilot-token';
import { createLogger } from '@/lib/logger';

const log = createLogger('CopilotAuth:Validate');

export async function POST(req: NextRequest) {
  try {
    const { github_token } = await req.json();

    if (!github_token || typeof github_token !== 'string') {
      return NextResponse.json({ error: 'github_token is required' }, { status: 400 });
    }

    const result = await resolveCopilotToken(github_token);
    const remainingSec = Math.max(0, Math.floor((result.expiresAt - Date.now()) / 1_000));

    return NextResponse.json({
      valid: true,
      expires_in_seconds: remainingSec,
      base_url: result.baseUrl,
    });
  } catch (error) {
    log.error('Validation error:', error);
    return NextResponse.json({
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
