// squadrules-compat-surface: asserts OAuth login-URL rewriting for the provisioned Keycloak client_id kairos-mcp
import { describe, expect, it } from '@jest/globals';
import { rewriteLoginUrlRedirectToApiBase } from '../../src/cli/rewrite-login-url.js';

describe('rewriteLoginUrlRedirectToApiBase', () => {
  it('rewrites redirect_uri to api base /auth/callback', () => {
    const login =
      'http://keycloak/realms/dev/protocol/openid-connect/auth?client_id=kairos-mcp&redirect_uri=http%3A%2F%2Flocalhost%3A3300%2Fauth%2Fcallback&response_type=code';
    const out = rewriteLoginUrlRedirectToApiBase(login, 'http://localhost:3301');
    expect(out).toContain('redirect_uri=');
    const u = new URL(out);
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:3301/auth/callback');
  });

  it('leaves non-auth-callback redirect_uri unchanged', () => {
    const login =
      'http://keycloak/realms/dev/protocol/openid-connect/auth?redirect_uri=http%3A%2F%2Flocalhost%3A9%2Fcb&response_type=code';
    const out = rewriteLoginUrlRedirectToApiBase(login, 'http://localhost:3301');
    expect(out).toBe(login);
  });

  it('returns original on invalid URL', () => {
    expect(rewriteLoginUrlRedirectToApiBase('not-a-url', 'http://localhost:3301')).toBe('not-a-url');
  });
});
