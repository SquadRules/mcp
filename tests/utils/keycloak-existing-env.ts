/**
 * Use existing Keycloak from .env (KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_CLIENT_ID) for auth tests.
 * Provisions hardcoded test user squadrules-tester via Admin API; no container.
 */

import type { KeycloakTestEnv } from './keycloak-container';
import {
  REALM,
  CLIENT_ID,
  TEST_USERNAME,
  TEST_PASSWORD,
  getAdminToken,
  createRealm,
  disableRealmDefaultRequiredActions,
  createClient,
  createUser,
  getUserIdByUsername,
  setUserPassword,
  clearUserRequiredActions,
  getTestUserTokenFromKeycloak
} from './keycloak-container';

async function provisionTestUserOnExistingKeycloak(
  baseUrl: string,
  realm: string = REALM,
  adminUsername: string = process.env.KEYCLOAK_ADMIN_USERNAME ?? 'admin',
  adminPassword: string = process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin'
): Promise<void> {
  let token: string;
  try {
    token = await getAdminToken(baseUrl, adminUsername, adminPassword);
  } catch {
    return;
  }
  await createRealm(baseUrl, token, realm);
  await disableRealmDefaultRequiredActions(baseUrl, token, realm);
  await createClient(baseUrl, token, realm);
  let userId = await createUser(baseUrl, token, realm);
  if (!userId) userId = (await getUserIdByUsername(baseUrl, token, realm)) ?? '';
  if (userId) {
    await setUserPassword(baseUrl, token, userId, realm);
    await clearUserRequiredActions(baseUrl, token, userId, realm);
  }
}

/**
 * Use existing Keycloak from .env. Provisions test user (squadrules-tester / squadrules-tester-secret).
 */
export async function useExistingKeycloakFromEnv(): Promise<KeycloakTestEnv> {
  const keycloakUrl = process.env.KEYCLOAK_URL?.replace(/\/$/, '') ?? '';
  const realm = process.env.KEYCLOAK_REALM ?? REALM;
  const clientId = process.env.KEYCLOAK_CLIENT_ID ?? CLIENT_ID;
  if (!keycloakUrl) {
    throw new Error(
      'useExistingKeycloakFromEnv requires KEYCLOAK_URL in .env (e.g. http://localhost:8080)'
    );
  }
  await provisionTestUserOnExistingKeycloak(keycloakUrl, realm);
  const getTestUserToken = () =>
    getTestUserTokenFromKeycloak(keycloakUrl, realm, clientId, TEST_USERNAME, TEST_PASSWORD);
  return {
    keycloakUrl,
    realm,
    clientId,
    testUsername: TEST_USERNAME,
    testPassword: TEST_PASSWORD,
    getTestUserToken
  };
}
