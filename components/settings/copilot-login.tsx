'use client';

/**
 * GitHub Copilot Login Component
 *
 * Implements the GitHub Device Flow for authenticating with GitHub Copilot:
 * 1. Request device code from GitHub
 * 2. Show user the verification URL and code
 * 3. Poll for access token completion
 * 4. Save the GitHub access token as the provider's API key
 *
 * The actual token exchange (GitHub token → Copilot runtime token)
 * happens server-side when making model requests.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle, LogIn, Copy, ExternalLink, LogOut, Save } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils';

interface CopilotLoginProps {
  /** Current stored GitHub access token (apiKey) */
  currentToken: string;
  /** Called when login succeeds with the GitHub access token */
  onLoginSuccess: (githubToken: string) => void;
  /** Called when user logs out (clears the token) */
  onLogout: () => void;
}

type LoginState =
  | { step: 'idle' }
  | { step: 'requesting' }
  | {
      step: 'waiting';
      userCode: string;
      verificationUri: string;
      deviceCode: string;
      expiresAt: number;
      intervalMs: number;
    }
  | { step: 'polling' }
  | { step: 'success' }
  | { step: 'error'; message: string };

export function CopilotLogin({ currentToken, onLoginSuccess, onLogout }: CopilotLoginProps) {
  const { t } = useI18n();
  const [state, setState] = useState<LoginState>({ step: 'idle' });
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    message: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const pollAbortRef = useRef<AbortController | null>(null);
  const [savedToServer, setSavedToServer] = useState(false);
  const [savingToServer, setSavingToServer] = useState(false);
  const lastRefreshTokenRef = useRef<{ token: string; expiresIn?: number } | null>(null);

  const isLoggedIn = !!currentToken;

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      pollAbortRef.current?.abort();
    };
  }, []);

  // Check if token is already saved to server
  useEffect(() => {
    fetch('/api/copilot-auth/save-token')
      .then((res) => res.json())
      .then((data) => {
        if (data.hasSavedToken) setSavedToServer(true);
      })
      .catch(() => { /* ignore */ });
  }, []);

  // Validate existing token on mount
  useEffect(() => {
    if (!currentToken) {
      setValidationResult(null);
      return;
    }

    let cancelled = false;
    setValidating(true);

    fetch('/api/copilot-auth/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ github_token: currentToken }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.valid) {
          setValidationResult({
            valid: true,
            message: t('settings.copilotTokenValid') || `Token valid (expires in ${data.expires_in_seconds}s)`,
          });
        } else {
          setValidationResult({
            valid: false,
            message: data.error || t('settings.copilotTokenInvalid') || 'Token invalid',
          });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setValidationResult(null);
      })
      .finally(() => {
        if (!cancelled) setValidating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentToken, t]);

  const handleLogin = useCallback(async () => {
    setState({ step: 'requesting' });

    try {
      // Step 1: Request device code
      const dcRes = await fetch('/api/copilot-auth/device-code', { method: 'POST' });
      if (!dcRes.ok) {
        const err = await dcRes.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${dcRes.status}`);
      }

      const dc = await dcRes.json();
      const expiresAt = Date.now() + dc.expires_in * 1000;
      const intervalMs = Math.max(1000, (dc.interval || 5) * 1000);

      setState({
        step: 'waiting',
        userCode: dc.user_code,
        verificationUri: dc.verification_uri,
        deviceCode: dc.device_code,
        expiresAt,
        intervalMs,
      });

      // Open the verification URI in a new tab
      window.open(dc.verification_uri, '_blank', 'noopener,noreferrer');

      // Step 2: Start polling
      const abortController = new AbortController();
      pollAbortRef.current = abortController;

      const pollForToken = async () => {
        while (Date.now() < expiresAt && !abortController.signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, intervalMs));

          if (abortController.signal.aborted) return;

          try {
            const tokenRes = await fetch('/api/copilot-auth/access-token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ device_code: dc.device_code }),
              signal: abortController.signal,
            });

            if (!tokenRes.ok) continue;

            const tokenData = await tokenRes.json();

            if (tokenData.status === 'complete' && tokenData.access_token) {
              setState({ step: 'success' });
              onLoginSuccess(tokenData.access_token);

              // Store refresh token for later save-to-server use
              if (tokenData.refresh_token) {
                lastRefreshTokenRef.current = {
                  token: tokenData.refresh_token,
                  expiresIn: tokenData.refresh_token_expires_in,
                };
              }

              // If previously saved to server, auto-update with new token + refresh token
              if (savedToServer) {
                fetch('/api/copilot-auth/save-token', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    github_token: tokenData.access_token,
                    refresh_token: tokenData.refresh_token,
                    refresh_token_expires_in: tokenData.refresh_token_expires_in,
                  }),
                }).catch(() => { /* ignore */ });
              }

              // Reset back to idle after a brief success display
              setTimeout(() => setState({ step: 'idle' }), 2000);
              return;
            }

            if (
              tokenData.status === 'expired_token' ||
              tokenData.status === 'access_denied'
            ) {
              throw new Error(tokenData.error || tokenData.status);
            }

            // authorization_pending or slow_down — keep polling
            if (tokenData.status === 'slow_down') {
              await new Promise((resolve) => setTimeout(resolve, 2000));
            }
          } catch (error) {
            if (abortController.signal.aborted) return;
            if (error instanceof DOMException && error.name === 'AbortError') return;
            throw error;
          }
        }

        if (!abortController.signal.aborted) {
          throw new Error('Device code expired. Please try again.');
        }
      };

      await pollForToken();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setState({ step: 'idle' });
        return;
      }
      setState({
        step: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, [onLoginSuccess]);

  const handleCancel = useCallback(() => {
    pollAbortRef.current?.abort();
    setState({ step: 'idle' });
  }, []);

  const handleCopyCode = useCallback(
    (code: string) => {
      navigator.clipboard.writeText(code).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    },
    [],
  );

  const handleLogout = useCallback(() => {
    pollAbortRef.current?.abort();
    setState({ step: 'idle' });
    setValidationResult(null);
    // Also clear server-saved token on logout
    if (savedToServer) {
      fetch('/api/copilot-auth/save-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear: true }),
      }).catch(() => { /* ignore */ });
      setSavedToServer(false);
    }
    onLogout();
  }, [onLogout, savedToServer]);

  const handleSaveToServer = useCallback(async () => {
    if (!currentToken) return;
    setSavingToServer(true);
    try {
      const payload: Record<string, unknown> = { github_token: currentToken };
      if (lastRefreshTokenRef.current) {
        payload.refresh_token = lastRefreshTokenRef.current.token;
        payload.refresh_token_expires_in = lastRefreshTokenRef.current.expiresIn;
      }
      const res = await fetch('/api/copilot-auth/save-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.saved) {
        setSavedToServer(true);
      }
    } catch { /* ignore */ }
    setSavingToServer(false);
  }, [currentToken]);

  const handleClearFromServer = useCallback(async () => {
    setSavingToServer(true);
    try {
      await fetch('/api/copilot-auth/save-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear: true }),
      });
      setSavedToServer(false);
    } catch { /* ignore */ }
    setSavingToServer(false);
  }, []);

  return (
    <div className="space-y-4">
      {/* Login status */}
      {isLoggedIn && (
        <div className="space-y-3">
          <div
            className={cn(
              'rounded-lg border p-3 text-sm',
              validating
                ? 'border-muted bg-muted/30 text-muted-foreground'
                : validationResult?.valid
                  ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/30 dark:text-green-300'
                  : validationResult && !validationResult.valid
                    ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300'
                    : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300',
            )}
          >
            <div className="flex items-center gap-2">
              {validating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : validationResult?.valid ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : validationResult && !validationResult.valid ? (
                <XCircle className="h-4 w-4" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              <span>
                {validating
                  ? (t('settings.copilotValidating') || 'Validating...')
                  : validationResult
                    ? validationResult.message
                    : (t('settings.copilotLoggedIn') || 'GitHub Copilot authenticated')}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleLogin} className="gap-1.5">
              <LogIn className="h-3.5 w-3.5" />
              {t('settings.copilotReLogin') || 'Re-login'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleLogout} className="gap-1.5">
              <LogOut className="h-3.5 w-3.5" />
              {t('settings.copilotLogout') || 'Logout'}
            </Button>
          </div>

          {/* Save to server for API access */}
          <div className="rounded-lg border border-muted p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {t('settings.copilotSaveToServer') || 'Share token with server'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('settings.copilotSaveToServerDesc') ||
                    'Save the GitHub token locally so the server can use GitHub Copilot for API calls (e.g. classroom generation)'}
                </p>
              </div>
              {savedToServer ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearFromServer}
                  disabled={savingToServer}
                  className="gap-1.5 shrink-0"
                >
                  {savingToServer ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5" />
                  )}
                  {t('settings.copilotClearFromServer') || 'Clear'}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSaveToServer}
                  disabled={savingToServer}
                  className="gap-1.5 shrink-0"
                >
                  {savingToServer ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  {t('settings.copilotSaveToServerBtn') || 'Save to server'}
                </Button>
              )}
            </div>
            {savedToServer && (
              <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-3 w-3" />
                {t('settings.copilotSavedToServer') || 'Token saved — server can use GitHub Copilot'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Login flow */}
      {!isLoggedIn && state.step === 'idle' && (
        <Button onClick={handleLogin} className="gap-2">
          <LogIn className="h-4 w-4" />
          {t('settings.copilotLogin') || 'Login with GitHub'}
        </Button>
      )}

      {state.step === 'requesting' && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{t('settings.copilotRequesting') || 'Requesting device code...'}</span>
        </div>
      )}

      {state.step === 'waiting' && (
        <div className="space-y-3">
          <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 p-4">
            <p className="text-sm text-blue-700 dark:text-blue-300 mb-3">
              {t('settings.copilotVisitUrl') ||
                'Visit the URL below and enter the code to authorize:'}
            </p>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <a
                  href={state.verificationUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-blue-600 dark:text-blue-400 underline hover:no-underline flex items-center gap-1"
                >
                  {state.verificationUri}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <div className="flex items-center gap-2">
                <code className="text-lg font-bold tracking-widest bg-white dark:bg-gray-900 px-3 py-1.5 rounded border">
                  {state.userCode}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopyCode(state.userCode)}
                  className="gap-1"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {copied
                    ? (t('settings.copied') || 'Copied!')
                    : (t('settings.copyCode') || 'Copy')}
                </Button>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>
                {t('settings.copilotWaiting') || 'Waiting for authorization...'}
              </span>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleCancel}>
            {t('settings.cancel') || 'Cancel'}
          </Button>
        </div>
      )}

      {state.step === 'success' && (
        <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
          <CheckCircle2 className="h-4 w-4" />
          <span>{t('settings.copilotLoginSuccess') || 'Login successful!'}</span>
        </div>
      )}

      {state.step === 'error' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <XCircle className="h-4 w-4" />
            <span>{state.message}</span>
          </div>
          <Button variant="outline" size="sm" onClick={handleLogin} className="gap-1.5">
            <LogIn className="h-3.5 w-3.5" />
            {t('settings.copilotRetry') || 'Try again'}
          </Button>
        </div>
      )}
    </div>
  );
}
