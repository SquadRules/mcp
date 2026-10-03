import { cleanupViaApi, cleanupViaCli, cleanupViaMcp } from '../utils/artifact-fixture-cleanup.js';

describe('artifact-fixture-cleanup', () => {
  const adapterUri = 'squadrules://adapter/artifact-fixture-parent';
  const artifactUris = [
    'squadrules://artifact/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'squadrules://layer/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  ];

  it('calls API delete with adapter plus normalized artifact layer URIs', async () => {
    const originalFetch = global.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          results: [],
          total_deleted: 3,
          total_failed: 0
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    try {
      await cleanupViaApi(adapterUri, artifactUris);
      expect(calls).toHaveLength(1);
      const parsed = JSON.parse(String(calls[0]!.init?.body)) as { uris: string[] };
      expect(parsed.uris).toEqual([
        adapterUri,
        'squadrules://layer/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'squadrules://layer/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      ]);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('calls MCP delete tool with normalized URIs', async () => {
    const calls: unknown[] = [];
    const callTool = async (args: unknown) => {
      calls.push(args);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              results: [
                { uri: adapterUri, status: 'deleted', message: 'ok' },
                { uri: 'squadrules://layer/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', status: 'deleted', message: 'ok' },
                { uri: 'squadrules://layer/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', status: 'deleted', message: 'ok' }
              ],
              total_deleted: 3,
              total_failed: 0
            })
          }
        ]
      };
    };
    const mcp = { client: { callTool } } as Parameters<typeof cleanupViaMcp>[0];
    await cleanupViaMcp(mcp, adapterUri, artifactUris);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      name: 'delete',
      arguments: {
        uris: [
          adapterUri,
          'squadrules://layer/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          'squadrules://layer/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
        ]
      }
    });
  });

  it('builds CLI delete command with all cleanup URIs', async () => {
    const execCalls: string[] = [];
    await cleanupViaCli(adapterUri, artifactUris, async (cmd: string) => {
      execCalls.push(cmd);
      return {
        stdout: JSON.stringify({
          results: [],
          total_deleted: 3,
          total_failed: 0
        }),
        stderr: ''
      };
    });
    expect(execCalls).toHaveLength(1);
    expect(execCalls[0]).toContain(' delete ');
    expect(execCalls[0]).toContain(adapterUri);
    expect(execCalls[0]).toContain('squadrules://layer/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  });
});
