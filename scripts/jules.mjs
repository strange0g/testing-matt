#!/usr/bin/env node

/**
 * Jules Bridge CLI
 * Communicates with the Google Jules REST API (jules.googleapis.com/v1alpha)
 * to dispatch, monitor, and verify autonomous coding sessions.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');
const SESSIONS_DIR = join(REPO_ROOT, '.jules');
const SESSIONS_FILE = join(SESSIONS_DIR, 'active-sessions.json');
const DEFAULT_API_BASE = 'https://jules.googleapis.com/v1alpha';

export function loadApiKey(customKey = null) {
  if (customKey) return customKey;
  if (process.env.JULES_API_KEY) return process.env.JULES_API_KEY.trim();

  const envFile = join(REPO_ROOT, '.env');
  if (existsSync(envFile)) {
    const content = readFileSync(envFile, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('JULES_API_KEY=')) {
        return trimmed.replace('JULES_API_KEY=', '').trim();
      }
    }
  }
  return null;
}

export function parseGitRemote(remoteUrl) {
  if (!remoteUrl) return null;
  const cleaned = remoteUrl.trim();
  // Match git@github.com:owner/repo.git or https://github.com/owner/repo.git
  const sshMatch = cleaned.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }
  return null;
}

export function getRepoOwnerAndName() {
  try {
    const remoteUrl = execSync('git remote get-url origin', { cwd: REPO_ROOT, encoding: 'utf8' });
    return parseGitRemote(remoteUrl);
  } catch {
    return null;
  }
}

export function loadSessionRegistry(filePath = SESSIONS_FILE) {
  if (!existsSync(filePath)) return [];
  try {
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveSessionRegistry(sessions, filePath = SESSIONS_FILE) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(sessions, null, 2), 'utf8');
}

export function recordSession(sessionRecord, filePath = SESSIONS_FILE) {
  const sessions = loadSessionRegistry(filePath);
  const existingIdx = sessions.findIndex(s => s.sessionId === sessionRecord.sessionId);
  if (existingIdx >= 0) {
    sessions[existingIdx] = { ...sessions[existingIdx], ...sessionRecord };
  } else {
    sessions.push(sessionRecord);
  }
  saveSessionRegistry(sessions, filePath);
}

export async function makeJulesRequest(path, options = {}, config = {}) {
  const apiBase = config.apiBase || process.env.JULES_API_BASE || DEFAULT_API_BASE;
  const apiKey = config.apiKey || loadApiKey();

  if (!apiKey) {
    throw new Error('JULES_API_KEY is not set. Provide it in environment or .env file.');
  }

  const url = `${apiBase}${path}`;
  const headers = {
    'X-Goog-Api-Key': apiKey,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const response = await fetch(url, {
    ...options,
    headers
  });

  const text = await response.text();
  let json = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { rawText: text };
    }
  }

  if (!response.ok) {
    const message = json.error?.message || response.statusText || 'API request failed';
    const err = new Error(`Jules API error (${response.status}): ${message}`);
    err.status = response.status;
    err.data = json;
    throw err;
  }

  return json;
}

export async function checkSources(config = {}) {
  return await makeJulesRequest('/sources', { method: 'GET' }, config);
}

export async function dispatchTask({
  prompt,
  title,
  startingBranch = 'main',
  repo = null,
  role = 'coder',
  config = {}
}) {
  const targetRepo = repo || getRepoOwnerAndName();
  if (!targetRepo) {
    throw new Error('Unable to determine GitHub repository. Ensure git remote origin is configured.');
  }

  const payload = {
    prompt,
    title: title || `${role === 'tester' ? 'Verify' : 'Implement'}: ${targetRepo}`,
    sourceContext: {
      source: `sources/github/${targetRepo}`,
      githubRepoContext: {
        startingBranch
      }
    },
    requirePlanApproval: false,
    automationMode: 'AUTO_CREATE_PR'
  };

  const result = await makeJulesRequest('/sessions', {
    method: 'POST',
    body: JSON.stringify(payload)
  }, config);

  const sessionId = result.name || result.id;
  const record = {
    sessionId,
    role,
    repo: targetRepo,
    startingBranch,
    title: payload.title,
    state: result.state || 'QUEUED',
    createdAt: new Date().toISOString(),
    prUrl: null
  };

  recordSession(record, config.registryFile);
  return { ...result, record };
}

export async function getSessionStatus(sessionId, config = {}) {
  const normalizedId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;
  const result = await makeJulesRequest(`/${normalizedId}`, { method: 'GET' }, config);

  let prUrl = null;
  if (Array.isArray(result.outputs)) {
    for (const output of result.outputs) {
      if (output.pullRequest?.url) {
        prUrl = output.pullRequest.url;
        break;
      }
    }
  }

  const recordUpdate = {
    sessionId: result.name || normalizedId,
    state: result.state,
    prUrl: prUrl || undefined,
    updatedAt: new Date().toISOString()
  };
  recordSession(recordUpdate, config.registryFile);

  return { ...result, prUrl };
}

export async function sendMessage(sessionId, messageText, config = {}) {
  const normalizedId = sessionId.startsWith('sessions/') ? sessionId : `sessions/${sessionId}`;
  return await makeJulesRequest(`/${normalizedId}:sendMessage`, {
    method: 'POST',
    body: JSON.stringify({ prompt: messageText })
  }, config);
}

export async function waitForSession(sessionId, { pollIntervalMs = 20000, timeoutMs = 1800000, onProgress = null, config = {} } = {}) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const status = await getSessionStatus(sessionId, config);
    if (onProgress) {
      onProgress(status);
    }

    if (status.state === 'COMPLETED') {
      return status;
    }
    if (status.state === 'FAILED') {
      throw new Error(`Jules session ${sessionId} failed. Details: ${JSON.stringify(status)}`);
    }

    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`Session ${sessionId} timed out after ${timeoutMs / 1000} seconds`);
}

// CLI Argument Parsing
function parseArgs(args) {
  const parsed = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        parsed[key] = next;
        i++;
      } else {
        parsed[key] = true;
      }
    } else {
      parsed._.push(arg);
    }
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  try {
    switch (command) {
      case 'check-sources': {
        const sources = await checkSources();
        console.log(JSON.stringify(sources, null, 2));
        break;
      }
      case 'dispatch': {
        if (!args.prompt) {
          console.error('Error: --prompt is required');
          process.exit(1);
        }
        const result = await dispatchTask({
          prompt: args.prompt,
          title: args.title,
          startingBranch: args.branch || 'main',
          repo: args.repo,
          role: 'coder'
        });
        console.log(JSON.stringify({
          success: true,
          sessionId: result.record.sessionId,
          state: result.record.state,
          title: result.record.title
        }, null, 2));
        break;
      }
      case 'dispatch-tester': {
        if (!args.prompt) {
          console.error('Error: --prompt is required');
          process.exit(1);
        }
        if (!args['pr-branch']) {
          console.error('Error: --pr-branch is required for tester agent');
          process.exit(1);
        }
        const result = await dispatchTask({
          prompt: args.prompt,
          title: args.title || `Test Verification: ${args['pr-branch']}`,
          startingBranch: args['pr-branch'],
          repo: args.repo,
          role: 'tester'
        });
        console.log(JSON.stringify({
          success: true,
          sessionId: result.record.sessionId,
          state: result.record.state,
          role: 'tester'
        }, null, 2));
        break;
      }
      case 'status': {
        const sessionId = args._[1] || args.session;
        if (!sessionId) {
          console.error('Error: session ID is required');
          process.exit(1);
        }
        const status = await getSessionStatus(sessionId);
        console.log(JSON.stringify(status, null, 2));
        break;
      }
      case 'wait': {
        const sessionId = args._[1] || args.session;
        if (!sessionId) {
          console.error('Error: session ID is required');
          process.exit(1);
        }
        console.log(`Watching session ${sessionId}...`);
        const finalStatus = await waitForSession(sessionId, {
          pollIntervalMs: 15000,
          onProgress: s => console.log(`[${new Date().toLocaleTimeString()}] State: ${s.state}`)
        });
        console.log(JSON.stringify({
          completed: true,
          sessionId,
          state: finalStatus.state,
          prUrl: finalStatus.prUrl
        }, null, 2));
        break;
      }
      case 'message': {
        const sessionId = args._[1] || args.session;
        const text = args.text || args.prompt;
        if (!sessionId || !text) {
          console.error('Error: session ID and --text are required');
          process.exit(1);
        }
        const reply = await sendMessage(sessionId, text);
        console.log(JSON.stringify({ sent: true, reply }, null, 2));
        break;
      }
      case 'pr': {
        const sessionId = args._[1] || args.session;
        if (!sessionId) {
          console.error('Error: session ID is required');
          process.exit(1);
        }
        const status = await getSessionStatus(sessionId);
        if (status.prUrl) {
          console.log(status.prUrl);
        } else {
          console.log('No PR open yet for this session.');
        }
        break;
      }
      case 'list': {
        const sessions = loadSessionRegistry();
        console.log(JSON.stringify(sessions, null, 2));
        break;
      }
      default: {
        console.log(`
Usage: node scripts/jules.mjs <command> [options]

Commands:
  check-sources                       List connected GitHub sources
  dispatch --prompt "..."             Dispatch Jules Coder Agent
  dispatch-tester --pr-branch "..."   Dispatch Jules Tester Agent on PR branch
  status <session-id>                 Check session state
  wait <session-id>                   Poll and wait until completion
  message <session-id> --text "..."   Send feedback to session
  pr <session-id>                     Get PR URL for session
  list                                List locally tracked sessions
`);
      }
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
