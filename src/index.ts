#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pathToFileURL } from 'node:url';
import { SleeperApi } from './api.js';
import { registerDerivedTools } from './tools/derived.js';
import { registerRawTools } from './tools/raw.js';

export function createServer(api = new SleeperApi()): McpServer {
  const server = new McpServer(
    { name: 'sleeper-mcp', version: '0.1.0' },
    {
      capabilities: { tools: {}, resources: {} },
      instructions: [
        'Read-only access to the Sleeper fantasy sports API (no authentication required).',
        '',
        'Start from sleeper_find_leagues when you have a username - it resolves the user and lists their leagues in one call.',
        'Prefer the derived tools (sleeper_get_standings, sleeper_get_roster, sleeper_get_matchup_report,',
        'sleeper_get_transaction_feed, sleeper_get_draft_board) over the raw endpoint wrappers: Sleeper returns opaque',
        'player and roster IDs, and the derived tools resolve them to names for you.',
        'When a question says "this week" or "this season", check sleeper_get_nfl_state first.',
      ].join('\n'),
    },
  );

  registerRawTools(server, api);
  registerDerivedTools(server, api);

  server.registerResource(
    'nfl-state',
    'sleeper://nfl/state',
    {
      title: 'Current NFL state',
      description: 'Current season, week and season type, so the model can orient without a tool call.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const state = await api.getState('nfl');
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(state, null, 2) }] };
    },
  );

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  // stdout is the MCP transport - anything logged there corrupts the protocol.
  console.error('sleeper-mcp running on stdio');
}

// pathToFileURL, not string concat - a Windows path like C:\... is not a valid file:// body.
const isEntrypoint = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
if (isEntrypoint || process.env.SLEEPER_MCP_FORCE_START === '1') {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
