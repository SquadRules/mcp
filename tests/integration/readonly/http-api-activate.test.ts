// squadrules-compat-surface: dual-emits the kairos_local_artifact_dir JSON field expected by existing clients
import { API_BASE, apiFetch } from '../http-api-test-helpers.js';
import { isHttpTransport } from '../../utils/auth-headers.js';

const _d = isHttpTransport() ? describe : describe.skip;

_d('HTTP REST API Activate Endpoint', () => {
  describe('POST /api/activate', () => {
    test('searches for adapter entry layers', async () => {
      expect.hasAssertions();
      const query = `Test Query ${Date.now()}`;
      const response = await apiFetch(`${API_BASE}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as Record<string, unknown>;
      // Activate HTTP response keeps canonical top-level keys; artifact-dir aliases are optional.
      const baseSearchKeys = ['choices', 'message', 'must_obey', 'next_action', 'query'];
      const optionalKeys = [
        ...('execution_id' in data ? ['execution_id'] : []),
        ...('kairos_local_artifact_dir' in data ? ['kairos_local_artifact_dir'] : []),
        ...('squadrules_local_artifact_dir' in data ? ['squadrules_local_artifact_dir'] : [])
      ];
      expect(Object.keys(data).sort()).toEqual([...baseSearchKeys, ...optionalKeys].sort());
      expect(data.must_obey).toBe(true);
      expect(Array.isArray(data.choices)).toBe(true);
      expect(typeof data.message).toBe('string');
      expect(typeof data.next_action).toBe('string');
      expect(data.query).toBe(query);
      if ('execution_id' in data) {
        expect(typeof data.execution_id).toBe('string');
        expect(data.execution_id as string).toMatch(/^[0-9a-f-]{36}$/i);
      }
      if ('kairos_local_artifact_dir' in data) {
        const hints = data.kairos_local_artifact_dir;
        // Field is now an ordered array of client-resolvable URI hints; never a server filesystem path.
        expect(Array.isArray(hints)).toBe(true);
        expect((hints as unknown[]).length).toBeGreaterThan(0);
        for (const hint of hints as unknown[]) {
          expect(typeof hint).toBe('string');
          expect(hint as string).toMatch(/^(project|user):\/\/[^/]/);
          // Regression guard: server must never leak its own filesystem (Docker container `/app/...`,
          // host absolute paths, or any node_modules path).
          expect(hint as string).not.toMatch(/^\//);
          expect(hint as string).not.toContain('node_modules');
          expect(hint as string).not.toContain('/app/');
        }
      }
      if (data.metadata && typeof data.metadata === 'object' && data.metadata !== null && 'duration_ms' in data.metadata) {
        expect(typeof (data.metadata as { duration_ms?: number }).duration_ms).toBe('number');
      }
    }, 30000);

    test('rejects empty query', async () => {
      expect.hasAssertions();
      const response = await apiFetch(`${API_BASE}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '' })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error', 'INVALID_INPUT');
    });

    test('rejects oversized JSON bodies', async () => {
      expect.hasAssertions();
      const response = await apiFetch(`${API_BASE}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'x'.repeat(1_100_000) })
      });

      expect(response.status).toBe(413);
      const data = await response.json();
      expect(data).toHaveProperty('error', 'PAYLOAD_TOO_LARGE');
    }, 30000);
  });
});
