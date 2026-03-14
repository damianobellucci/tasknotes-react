import {
    CognitoIdentityProviderClient,
    InitiateAuthCommand,
    RespondToAuthChallengeCommand,
} from '@aws-sdk/client-cognito-identity-provider';

export type CognitoSession = {
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export type LoginResult = {
  ok: boolean;
  error?: string;
  newPasswordRequired?: boolean;
  session?: string;
  authSession?: CognitoSession;
};

type CognitoConfig = {
  region: string;
  clientId: string;
};

let config: CognitoConfig | null = null;

function mapCognitoError(err: unknown, fallback: string): string {
  const anyErr = err as { name?: string; message?: string };
  const type = anyErr?.name || '';
  if (type === 'NotAuthorizedException') return 'Email or password are invalid';
  if (type === 'UserNotFoundException') return 'User not found';
  if (type === 'UserNotConfirmedException') return 'User not confirmed';
  return anyErr?.message || fallback;
}

function ensureConfig(): CognitoConfig {
  if (!config?.region || !config.clientId) {
    throw new Error('Cognito is not configured');
  }
  return config;
}

function createClient(region: string): CognitoIdentityProviderClient {
  return new CognitoIdentityProviderClient({ region });
}

function buildSession(email: string, result: {
  IdToken?: string;
  AccessToken?: string;
  RefreshToken?: string;
  ExpiresIn?: number;
}): CognitoSession {
  const idToken = result.IdToken ?? '';
  const accessToken = result.AccessToken ?? '';
  const refreshToken = result.RefreshToken ?? '';
  return {
    email,
    // Desktop sends ID token to backend; keep same behavior.
    accessToken: idToken || accessToken,
    refreshToken,
    expiresAt: Date.now() + (result.ExpiresIn ?? 3600) * 1000,
  };
}

export function configureAmplify(region: string, clientId: string) {
  config = {
    region: region.trim(),
    clientId: clientId.trim(),
  };
}

export async function loginCognito(email: string, password: string): Promise<LoginResult> {
  try {
    const { region, clientId } = ensureConfig();
    const client = createClient(region);
    const command = new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: clientId,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    });
    const data = await client.send(command);
    if (data.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
      return {
        ok: false,
        newPasswordRequired: true,
        session: data.Session,
      };
    }
    if (!data.AuthenticationResult?.IdToken && !data.AuthenticationResult?.AccessToken) {
      return {
        ok: false,
        error: `Unexpected auth response: ${data.ChallengeName || 'no token'}`,
      };
    }
    return {
      ok: true,
      authSession: buildSession(email, data.AuthenticationResult),
    };
  } catch (err) {
    return {
      ok: false,
      error: mapCognitoError(err, 'Login failed'),
    };
  }
}

export async function completeNewPassword(
  email: string,
  newPassword: string,
  sessionToken: string
): Promise<LoginResult> {
  try {
    const { region, clientId } = ensureConfig();
    const client = createClient(region);
    const command = new RespondToAuthChallengeCommand({
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      ClientId: clientId,
      Session: sessionToken,
      ChallengeResponses: {
        USERNAME: email,
        NEW_PASSWORD: newPassword,
      },
    });
    const data = await client.send(command);
    if (!data.AuthenticationResult?.IdToken && !data.AuthenticationResult?.AccessToken) {
      return {
        ok: false,
        error: 'Unexpected response after password change',
      };
    }
    return {
      ok: true,
      authSession: buildSession(email, data.AuthenticationResult),
    };
  } catch (err) {
    return {
      ok: false,
      error: mapCognitoError(err, 'Password update failed'),
    };
  }
}

export async function refreshCognitoSession(refreshToken: string, email = ''): Promise<LoginResult> {
  try {
    const { region, clientId } = ensureConfig();
    if (!refreshToken) {
      return { ok: false, error: 'Missing refresh token' };
    }
    const client = createClient(region);
    const command = new InitiateAuthCommand({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: clientId,
      AuthParameters: {
        REFRESH_TOKEN: refreshToken,
      },
    });
    const data = await client.send(command);
    if (!data.AuthenticationResult?.IdToken && !data.AuthenticationResult?.AccessToken) {
      return {
        ok: false,
        error: 'Unexpected refresh response',
      };
    }
    return {
      ok: true,
      authSession: buildSession(email, {
        ...data.AuthenticationResult,
        RefreshToken: refreshToken,
      }),
    };
  } catch (err) {
    return {
      ok: false,
      error: mapCognitoError(err, 'Refresh failed'),
    };
  }
}

export async function logoutCognito() {
  // Desktop also handles logout locally by clearing the persisted session.
  return;
}
