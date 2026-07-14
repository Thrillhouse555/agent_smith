import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_URL = process.env.API_URL || 'http://127.0.0.1:3000';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || null;
const configuredOutputDir = process.env.AGENT_SMITH_OUTPUT_DIR || path.join('/tmp', 'agent-smith-summaries');

async function resolveReadableOutputDir() {
  const candidates = [
    configuredOutputDir,
    path.join(os.tmpdir(), `agent-smith-summaries-${process.getuid?.() ?? 'user'}`),
    path.join(os.tmpdir(), 'agent-smith-summaries-fallback')
  ];

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) {
        return candidate;
      }
    } catch {
      // try next candidate
    }
  }

  throw new Error(
    `No readable output directory found. Checked: ${candidates.join(', ')}. ` +
    `Run review-agent-smith-events.mjs first or set AGENT_SMITH_OUTPUT_DIR.`
  );
}

function computeWindow(summary) {
  const fromRaw = summary?.window?.from;
  const toRaw = summary?.window?.to;

  const from = fromRaw ? new Date(fromRaw) : null;
  const to = toRaw ? new Date(toRaw) : null;

  if (from && to && !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && to >= from) {
    return { windowFrom: from.toISOString(), windowTo: to.toISOString() };
  }

  const now = new Date();
  const fallbackFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return { windowFrom: fallbackFrom.toISOString(), windowTo: now.toISOString() };
}

async function main() {
  const outputDir = await resolveReadableOutputDir();
  const finalPath = path.join(outputDir, 'agent-smith-summary-final.json');
  const raw = await fs.readFile(finalPath, 'utf-8');
  const summaryJson = JSON.parse(raw);

  if (!summaryJson || typeof summaryJson !== 'object') {
    throw new Error('Final summary file is invalid JSON object.');
  }

  if (!summaryJson.summaryText || typeof summaryJson.summaryText !== 'string') {
    throw new Error('summaryJson.summaryText is required in final summary file.');
  }

  const { windowFrom, windowTo } = computeWindow(summaryJson);
  const payload = {
    windowFrom,
    windowTo,
    model: OLLAMA_MODEL,
    summaryJson
  };

  const url = `${API_URL}/api/agent-smith/summaries`;
  console.log(`Saving summary to ${url}...`);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const bodyText = await response.text();
  if (!response.ok) {
    if (response.status === 404 && bodyText.includes('Cannot POST /api/agent-smith/summaries')) {
      throw new Error(
        `Failed to save summary: API route /api/agent-smith/summaries is not available at ${API_URL}. ` +
        `Deploy/restart my-api with latest Agent Smith routes, then retry.`
      );
    }
    throw new Error(`Failed to save summary (${response.status}): ${bodyText}`);
  }

  console.log(`Saved summary successfully: ${bodyText}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
