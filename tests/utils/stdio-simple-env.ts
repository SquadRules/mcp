/**
 * Env for spawning the server as a local stdio (simple-mode) subprocess in tests.
 *
 * stdio is local simple mode: auth off, embedded LanceDB, no HTTP listener. Since
 * `src/config/runtime-mode.ts` refuses to boot a stdio process that contradicts that
 * (`AUTH_ENABLED=true` or a non-empty `QDRANT_URL`), the ambient values copied from
 * `.env` / the active `.env.<profile>` must be overridden here rather than passed
 * through — a stdio child inheriting the clustered profile would now fail at startup
 * instead of silently answering with an empty space allowlist.
 *
 * `REDIS_URL` is deliberately left alone: a shared key-value backend does not
 * contradict local mode, and the profiles set it explicitly.
 */
export function applyLocalStdioEnv<T extends Record<string, string | undefined>>(env: T): void {
  Object.assign(env, { TRANSPORT_TYPE: 'stdio', AUTH_ENABLED: 'false', QDRANT_URL: '' });
}
