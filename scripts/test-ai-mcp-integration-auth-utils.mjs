import fs from 'fs';
import path from 'path';

export function loadIntegrationBearer(root) {
  const fromEnv = process.env.SQUADRULES_INTEGRATION_BEARER?.trim();
  if (fromEnv) return fromEnv;
  const authPath = path.join(root, '.test-auth-env.dev.json');
  try {
    if (!fs.existsSync(authPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    const token = parsed?.bearerToken;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export function buildAuthHeaders(bearer) {
  return bearer ? { Authorization: `Bearer ${bearer}` } : {};
}
