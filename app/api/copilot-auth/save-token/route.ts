/**
 * POST /api/copilot-auth/save-token
 *
 * Save or clear the GitHub access token to local file for server-side use.
 * This allows server-side code (e.g. /api/generate-classroom) to use
 * GitHub Copilot without needing GITHUB_COPILOT_API_KEY in env.
 *
 * Body: { github_token: string } — save token
 * Body: { clear: true }         — clear saved token
 *
 * Response: { saved: boolean }
 */

import { NextResponse, type NextRequest } from 'next/server';
import {
  saveCopilotGithubToken,
  clearCopilotGithubToken,
  hasSavedCopilotToken,
} from '@/lib/server/copilot-token-store';
import { resolveCopilotToken } from '@/lib/server/copilot-token';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Clear token
    if (body.clear === true) {
      await clearCopilotGithubToken();
      return NextResponse.json({ saved: false, message: 'Token cleared' });
    }

    // Save token
    const { github_token } = body;
    if (!github_token || typeof github_token !== 'string') {
      return NextResponse.json({ error: 'github_token is required' }, { status: 400 });
    }

    // Validate the token first by attempting a Copilot token exchange
    try {
      await resolveCopilotToken(github_token);
    } catch {
      return NextResponse.json(
        { error: 'Invalid GitHub token — Copilot token exchange failed' },
        { status: 401 },
      );
    }

    await saveCopilotGithubToken(github_token);
    return NextResponse.json({ saved: true, message: 'Token saved for server-side use' });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

/**
 * GET /api/copilot-auth/save-token
 *
 * Check if a saved token exists.
 */
export async function GET() {
  try {
    const hasSaved = await hasSavedCopilotToken();
    return NextResponse.json({ hasSavedToken: hasSaved });
  } catch {
    return NextResponse.json({ hasSavedToken: false });
  }
}
