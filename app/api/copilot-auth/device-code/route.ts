/**
 * POST /api/copilot-auth/device-code
 *
 * Step 1 of GitHub Device Flow: Request a device code.
 * Returns verification_uri + user_code for the user to authorize.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';

const log = createLogger('CopilotAuth:DeviceCode');

const CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';

export async function POST(_req: NextRequest) {
  try {
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      scope: 'read:user',
    });

    const res = await fetch(DEVICE_CODE_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!res.ok) {
      log.error(`GitHub device code request failed: HTTP ${res.status}`);
      return NextResponse.json(
        { error: `GitHub device code request failed: HTTP ${res.status}` },
        { status: res.status },
      );
    }

    const json = await res.json();

    if (!json.device_code || !json.user_code || !json.verification_uri) {
      log.error('GitHub device code response missing required fields');
      return NextResponse.json(
        { error: 'GitHub device code response missing required fields' },
        { status: 502 },
      );
    }

    return NextResponse.json({
      device_code: json.device_code,
      user_code: json.user_code,
      verification_uri: json.verification_uri,
      expires_in: json.expires_in,
      interval: json.interval,
    });
  } catch (error) {
    log.error('Device code request error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
