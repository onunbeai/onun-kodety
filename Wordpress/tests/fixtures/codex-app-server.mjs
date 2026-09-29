#!/usr/bin/env node
// Offline App Server double for startup/recovery tests. Never calls OpenAI.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const mode = process.env.KODETY_AGENT_TEST_MODE || 'ready';
if (process.env.KODETY_AGENT_TEST_SPAWNS) appendFileSync(process.env.KODETY_AGENT_TEST_SPAWNS, `${process.pid}\n`);
if (mode === 'exit') process.exit(7);
if (mode === 'ignore-term') process.on('SIGTERM', () => {});
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (!request.id || mode === 'hang' || mode === 'ignore-term') return;
  let result = {};
  if (request.method === 'permissionProfile/list') result = { data: mode === 'bad-profile' ? [] : [{ id: 'kodety-agent', allowed: true }] };
  if (request.method === 'account/read') result = { account: null };
  setTimeout(() => process.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`), request.method === 'initialize' ? 50 : 0);
});
