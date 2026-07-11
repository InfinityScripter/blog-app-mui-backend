import '@jest/globals';
import { createMocks } from 'node-mocks-http';
import { HTTP_METHOD } from '@/src/constants/http';
import publicHandler from '@/src/pages/api/llm-stats/public';
import { saveSnapshot } from '@/src/services/llm-stats-snapshot';

function sensitiveBundle() {
  return {
    kpis: { totalTokens: 100, totalCostUsd: 1, sessions: 1, activeDays: 1 },
    byModelFamily: [{ family: 'opus', tokens: 100, requests: 1, costUsd: 1 }],
    byModel: [],
    byHarness: [],
    // A snapshot that somehow still carries private detail (older push):
    byProject: [{ project: 'secret-work-repo', tokens: 50, requests: 1 }],
    trend: [],
    heatmap: [],
    claudeExtras: {
      topSkills: [{ name: 'stefania-internal', count: 3 }],
      topMcpTools: [{ name: 'mcp__stefania-devtools', count: 2 }],
      cacheHitRatio: 0.5,
      agentEvents: 1,
    },
    meta: {
      generatedAt: '2026-06-21T00:00:00.000Z',
      scannedFiles: 1,
      harnessesAvailable: ['claude-code'],
      warnings: ['claude-code: ENOENT /Users/someone/.claude/x'],
    },
  };
}

describe('GET /api/llm-stats/public', () => {
  it('returns aggregate data but strips all private fields, no auth needed', async () => {
    await saveSnapshot(sensitiveBundle());

    const { req, res } = createMocks({ method: HTTP_METHOD.GET });
    await publicHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    const bundle = body.data.bundle;
    // Aggregate data preserved…
    expect(bundle.kpis.totalTokens).toBe(100);
    expect(bundle.byModelFamily[0].family).toBe('opus');
    // …private fields stripped: project names, internal skill/MCP names, path warnings.
    expect(bundle.byProject).toEqual([]);
    expect(bundle.claudeExtras).toBeNull();
    expect(bundle.meta.warnings).toEqual([]);
  });

  it('returns a null bundle when no snapshot exists (not an error)', async () => {
    // saveSnapshot uses a fixed 'latest' id; clearing happens in the global
    // beforeEach, so this case runs against an empty table.
    const { req, res } = createMocks({ method: HTTP_METHOD.GET });
    await publicHandler(req, res);
    expect(res._getStatusCode()).toBe(200);
  });

  it('rejects non-GET methods', async () => {
    const { req, res } = createMocks({ method: HTTP_METHOD.POST });
    await publicHandler(req, res);
    expect(res._getStatusCode()).toBe(405);
  });
});
