// squadrules-compat-surface: references Keycloak realm/client or keyring service names (kairos-dev / kairos-prod / kairos-cli) provisioned in existing deployments
/**
 * Testcontainers-based Keycloak for auth integration tests.
 * Starts Keycloak, creates realm kairos-dev, client kairos-mcp, user kairos-tester.
 * User is created with credentials and requiredActions: [] in one POST to avoid "Account is not fully set up".
 */
import { GenericContainer, type StartedTestContainer } from 'testcontainers';

export const REALM = 'kairos-dev';
export const CLIENT_ID = 'kairos-mcp';
export const TEST_USERNAME = 'kairos-tester';
export const TEST_PASSWORD = 'kairos-tester-secret';

export interface KeycloakTestEnv {
  /** Set when using Testcontainers; undefined when using existing Keycloak from .env */
  container?: StartedTestContainer;
  keycloakUrl: string;
  realm: string;
  clientId: string;
  testUsername: string;
  testPassword: string;
  getTestUserToken: () => Promise<string>;
}

async function waitForKeycloak(baseUrl: string, maxAttempts = 60, intervalMs = 2000): Promise<void> {
  const tokenUrl = `${baseUrl.replace(/\/$/, '')}/realms/master/protocol/openid-connect/token`;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: 'admin-cli',
          username: 'admin',
          password: 'admin'
        })
      });
      if (res.ok) return;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Keycloak did not become ready at ${baseUrl} after ${maxAttempts} attempts`);
}

export async function getAdminToken(
  baseUrl: string,
  adminUsername = 'admin',
  adminPassword = 'admin'
): Promise<string> {
  const tokenUrl = `${baseUrl.replace(/\/$/, '')}/realms/master/protocol/openid-connect/token`;
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: adminUsername,
      password: adminPassword
    })
  });
  if (!res.ok) throw new Error(`Admin token failed: ${res.status}`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error('No access_token in admin token response');
  return data.access_token;
}

export async function createRealm(
  baseUrl: string,
  token: string,
  realm: string = REALM
): Promise<void> {
  const url = `${baseUrl.replace(/\/$/, '')}/admin/realms`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ realm, enabled: true })
  });
  if (res.status === 201) return;
  if (res.status === 409) return; // already exists
  throw new Error(`Create realm failed: ${res.status} ${await res.text()}`);
}

/** Disable default required actions on realm so new users don't get "Account is not fully set up". */
export async function disableRealmDefaultRequiredActions(
  baseUrl: string,
  token: string,
  realm: string = REALM
): Promise<void> {
  const listUrl = `${baseUrl.replace(/\/$/, '')}/admin/realms/${realm}/authentication/required-actions`;
  const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!listRes.ok) return;
  const actions = (await listRes.json()) as Array<{
    alias?: string;
    defaultAction?: boolean;
    enabled?: boolean;
  }>;
  for (const action of actions) {
    if (!action.alias) continue;
    const isUpdateProfile = action.alias === 'update_profile';
    const putUrl = `${listUrl}/${action.alias}`;
    await fetch(putUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...action,
        defaultAction: false,
        enabled: isUpdateProfile ? false : action.enabled
      })
    });
  }
}

export async function createClient(
  baseUrl: string,
  token: string,
  realm: string = REALM
): Promise<void> {
  const url = `${baseUrl.replace(/\/$/, '')}/admin/realms/${realm}/clients`;
  const body = {
    clientId: CLIENT_ID,
    publicClient: true,
    directAccessGrantsEnabled: true,
    redirectUris: [
      'http://localhost:3300/auth/callback',
      'http://localhost:3301/auth/callback',
      'http://localhost:3300/*',
      'http://localhost:3301/*'
    ],
    webOrigins: ['http://localhost:3300', 'http://localhost:3301'],
    enabled: true
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (res.status === 201) return;
  if (res.status === 409) return;
  throw new Error(`Create client failed: ${res.status} ${await res.text()}`);
}

/** Create user (no credentials); caller must call setUserPassword then clearUserRequiredActions. */
export async function createUser(
  baseUrl: string,
  token: string,
  realm: string = REALM
): Promise<string> {
  const url = `${baseUrl.replace(/\/$/, '')}/admin/realms/${realm}/users`;
  const body = {
    username: TEST_USERNAME,
    email: 'kairos-tester@localhost',
    firstName: 'Squadrules',
    lastName: 'Tester',
    enabled: true,
    emailVerified: true,
    requiredActions: [] as string[]
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (res.status === 201) {
    const loc = res.headers.get('Location');
    if (loc) return loc.replace(/\/+$/, '').split('/').pop() ?? '';
  }
  if (res.status === 409) {
    const searchRes = await fetch(
      `${baseUrl.replace(/\/$/, '')}/admin/realms/${realm}/users?username=${encodeURIComponent(TEST_USERNAME)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!searchRes.ok) throw new Error(`Find user failed: ${searchRes.status}`);
    const users = (await searchRes.json()) as Array<{ id?: string }>;
    const existingId = users[0]?.id;
    /** Do not delete+recreate: that drops Keycloak group membership from deploy-configure-keycloak-realms.py (#278). */
    if (existingId) return existingId;
  }
  throw new Error(`Create user failed: ${res.status} ${await res.text()}`);
}

/** Set user password via Admin API (temporary: false so no UPDATE_PASSWORD required action). */
export async function setUserPassword(
  baseUrl: string,
  token: string,
  userId: string,
  realm: string = REALM
): Promise<void> {
  const url = `${baseUrl.replace(/\/$/, '')}/admin/realms/${realm}/users/${userId}/reset-password`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ type: 'password', value: TEST_PASSWORD, temporary: false })
  });
  if (!res.ok) throw new Error(`Set password failed: ${res.status} ${await res.text()}`);
}

/** Clear required actions on user so password grant does not return "Account is not fully set up". */
export async function clearUserRequiredActions(
  baseUrl: string,
  token: string,
  userId: string,
  realm: string = REALM
): Promise<void> {
  const base = baseUrl.replace(/\/$/, '');
  const getUrl = `${base}/admin/realms/${realm}/users/${userId}`;
  const getRes = await fetch(getUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!getRes.ok) throw new Error(`Get user failed: ${getRes.status}`);
  const user = (await getRes.json()) as Record<string, unknown>;
  // Omit credentials and other read-only fields so PUT is accepted; force requiredActions to []
  const rest = { ...user };
  delete rest.credentials;
  const putRes = await fetch(getUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ ...rest, requiredActions: [] })
  });
  if (!putRes.ok) throw new Error(`Clear required actions failed: ${putRes.status} ${await putRes.text()}`);
}

export async function getUserIdByUsername(
  baseUrl: string,
  token: string,
  realm: string = REALM
): Promise<string | null> {
  const url = `${baseUrl.replace(/\/$/, '')}/admin/realms/${realm}/users?username=${encodeURIComponent(TEST_USERNAME)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const users = (await res.json()) as Array<{ id?: string }>;
  return users[0]?.id ?? null;
}

export function getTestUserTokenFromKeycloak(
  baseUrl: string,
  realm: string,
  clientId: string,
  username: string,
  password: string
): Promise<string> {
  const tokenUrl = `${baseUrl.replace(/\/$/, '')}/realms/${realm}/protocol/openid-connect/token`;
  // kairos-groups: matches tests/utils/auth-headers.ts (#278). Do not default to
  // profile/email here — explicit email scope can make Keycloak reject password grant
  // with "Account is not fully set up" when the test user is not email-verified.
  const scope =
    process.env.KAIROS_TEST_OIDC_SCOPE?.trim() || 'openid kairos-groups';
  const doRequest = () =>
    fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: clientId,
        username,
        password,
        scope
      })
    });
  return (async () => {
    let res = await doRequest();
    if (!res.ok) {
      const firstText = await res.text();
      if (res.status === 400 && firstText.includes('not fully set up')) {
        await new Promise((r) => setTimeout(r, 3000));
        res = await doRequest();
      }
      if (!res.ok) {
        const errText = res.bodyUsed ? firstText : await res.text();
        throw new Error(`Test user token failed: ${res.status} ${errText}`);
      }
    }
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) throw new Error('No access_token in test user token response');
    return data.access_token;
  })();
}

/**
 * Start Keycloak with Testcontainers, create realm, client, and kairos-tester user.
 * User is created with credentials in one POST (no separate reset-password) so password grant works.
 * Caller must stop the container when done.
 */
export async function startKeycloakWithTestUser(): Promise<KeycloakTestEnv> {
  const container = await new GenericContainer('quay.io/keycloak/keycloak:26.0')
    .withExposedPorts(8080)
    .withEnvironment({
      KEYCLOAK_ADMIN: 'admin',
      KEYCLOAK_ADMIN_PASSWORD: 'admin'
    })
    .withCommand(['start-dev'])
    .withStartupTimeout(300_000)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(8080);
  const keycloakUrl = `http://${host}:${port}`;

  await waitForKeycloak(keycloakUrl);
  const adminToken = await getAdminToken(keycloakUrl);
  await createRealm(keycloakUrl, adminToken);
  await disableRealmDefaultRequiredActions(keycloakUrl, adminToken);
  await createClient(keycloakUrl, adminToken);
  let userId: string | null = await createUser(keycloakUrl, adminToken) || null;
  if (!userId) userId = await getUserIdByUsername(keycloakUrl, adminToken);
  if (userId) {
    await setUserPassword(keycloakUrl, adminToken, userId);
    await clearUserRequiredActions(keycloakUrl, adminToken, userId);
    await new Promise((r) => setTimeout(r, 2000));
  }

  const getTestUserToken = () =>
    getTestUserTokenFromKeycloak(keycloakUrl, REALM, CLIENT_ID, TEST_USERNAME, TEST_PASSWORD);

  console.log('[Keycloak] Admin console:', `${keycloakUrl}/admin`);
  console.log('[Keycloak] Admin login: admin / admin');
  console.log('[Keycloak] Test user:', TEST_USERNAME, '/', TEST_PASSWORD);

  // await new Promise((r) => setTimeout(r, 10000000));

  return {
    container,
    keycloakUrl,
    realm: REALM,
    clientId: CLIENT_ID,
    testUsername: TEST_USERNAME,
    testPassword: TEST_PASSWORD,
    getTestUserToken
  };
}

export { useExistingKeycloakFromEnv } from './keycloak-existing-env';
