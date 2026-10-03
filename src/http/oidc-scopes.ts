// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
export const DEFAULT_OIDC_SCOPES_SUPPORTED: readonly string[] = Object.freeze([
  'openid',
  'profile',
  'email',
  'kairos-groups',
  'offline_access'
]);

export function parseOidcScopesSupported(raw: string | undefined): readonly string[] {
  if (raw === undefined) return DEFAULT_OIDC_SCOPES_SUPPORTED;

  const parsed = Array.from(
    new Set(
      raw
        .split(',')
        .map((scope) => scope.trim())
        .filter(Boolean)
    )
  );

  if (parsed.length === 0) {
    process.emitWarning(
      'KAIROS_OIDC_SCOPES_SUPPORTED resolved to an empty list; falling back to default scopes.',
      { code: 'KAIROS_OIDC_SCOPES_SUPPORTED_EMPTY' }
    );
    return DEFAULT_OIDC_SCOPES_SUPPORTED;
  }

  return Object.freeze(parsed);
}
