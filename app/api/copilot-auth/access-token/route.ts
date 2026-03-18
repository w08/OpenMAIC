/**
 * POST /api/copilot-auth/access-token
 *
 * Step 2 of GitHub Device Flow: Poll for access token.
 * Client calls this repeatedly until the user completes authorization.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';

const log = createLogger('CopilotAuth:AccessToken');

const CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

export async function POST(req: NextRequest) {
  try {
    const { device_code } = await req.json();

    if (!device_code || typeof device_code !== 'string') {
      return NextResponse.json({ error: 'device_code is required' }, { status: 400 });
    }

    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });

    const res = await fetch(ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!res.ok) {
      log.error(`GitHub access token request failed: HTTP ${res.status}`);
      return NextResponse.json(
        { error: `GitHub access token request failed: HTTP ${res.status}` },
        { status: res.status },
      );
    }

    const json = await res.json();

    // Successfully got token
    if (json.access_token && typeof json.access_token === 'string') {
      return NextResponse.json({
        access_token: json.access_token,
        refresh_token: json.refresh_token || undefined,
        refresh_token_expires_in: json.refresh_token_expires_in || undefined,
        status: 'complete',
      });
    }

    // Still waiting or error
    const error = json.error || 'unknown';
    return NextResponse.json({
      status: error, // 'authorization_pending', 'slow_down', 'expired_token', 'access_denied'
      error: json.error_description || error,
    });
  } catch (error) {
    log.error('Access token poll error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
