import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_URL = process.env.API_URL || 'http://127.0.0.1:3000';
const OLLAMA_COMPLETION_URL = process.env.OLLAMA_COMPLETION_URL || 'http://127.0.0.1:8081/v1/chat/completions';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL;
const SUMMARY_HOURS = Number(process.env.AGENT_SMITH_SUMMARY_HOURS || 24);
const configuredOutputDir = process.env.AGENT_SMITH_OUTPUT_DIR || path.join('/tmp', 'agent-smith-summaries');

async function resolveWritableOutputDir() {
  const candidates = [
    configuredOutputDir,
    path.join(os.tmpdir(), `agent-smith-summaries-${process.getuid?.() ?? 'user'}`),
    path.join(os.tmpdir(), 'agent-smith-summaries-fallback')
  ];

  for (const candidate of candidates) {
    try {
      await fs.mkdir(candidate, { recursive: true });
      const probePath = path.join(candidate, '.write-probe');
      await fs.writeFile(probePath, 'ok');
      await fs.unlink(probePath);
      if (candidate !== configuredOutputDir) {
        console.warn(`Output directory ${configuredOutputDir} is not writable. Using ${candidate} instead.`);
      }
      return candidate;
    } catch {
      // try next candidate
    }
  }

  throw new Error(
    `No writable output directory found. Checked: ${candidates.join(', ')}. ` +
    `Set AGENT_SMITH_OUTPUT_DIR to a writable path.`
  );
}

function extractCompletionText(rawResponse) {
  try {
    const parsed = JSON.parse(rawResponse);
    if (typeof parsed === 'string') return parsed;
    if (parsed?.choices?.[0]?.message?.content) return parsed.choices[0].message.content;
    if (parsed?.choices?.[0]?.text) return parsed.choices[0].text;
    if (parsed?.content && typeof parsed.content === 'string') return parsed.content;
    return rawResponse;
  } catch {
    return rawResponse;
  }
}

async function callChatCompletion({ url, model, maxTokens, temperature, systemPrompt, userPrompt, label }) {
  const completionUrl = url.endsWith('/completion')
    ? url.replace(/\/completion$/, '/v1/chat/completions')
    : url;

  console.log(`Running ${label} via ${completionUrl}...`);

  const requestBody = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature,
    max_tokens: maxTokens,
    stream: false,
    ...(model ? { model } : {})
  };

  let response;
  try {
    response = await fetch(completionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
  } catch (error) {
    if (error?.cause?.code === 'ECONNREFUSED') {
      throw new Error(
        `Cannot connect to ${label} at ${completionUrl} (ECONNREFUSED). ` +
        `Check that llama-server is running and reachable.`
      );
    }
    throw error;
  }

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${responseText}`);
  }

  return extractCompletionText(responseText).trim();
}

function parseModelJsonObject(rawText) {
  const text = String(rawText || '').trim();
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  let jsonText = (codeBlockMatch ? codeBlockMatch[1] : text).trim();

  const firstBrace = jsonText.indexOf('{');
  const lastBrace = jsonText.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    jsonText = jsonText.slice(firstBrace, lastBrace + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    console.error('Raw model output:');
    console.error(text);
    throw new Error(`Model output is not valid JSON object (${error.message}).`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Model output must be a JSON object.');
  }

  return parsed;
}

function validateSummary(summary) {
  const required = ['window', 'totals', 'summaryText', 'recommendations', 'confidence'];
  for (const key of required) {
    if (!(key in summary)) {
      throw new Error(`Summary is missing required field: ${key}`);
    }
  }

  if (typeof summary.summaryText !== 'string' || !summary.summaryText.trim()) {
    throw new Error('summaryText must be a non-empty string.');
  }

  if (!summary.window || typeof summary.window !== 'object') {
    throw new Error('window must be an object.');
  }

  if (!summary.window.from || !summary.window.to) {
    throw new Error('window.from and window.to are required.');
  }

  if (!summary.totals || typeof summary.totals !== 'object') {
    throw new Error('totals must be an object.');
  }

  if (!Array.isArray(summary.recommendations)) {
    throw new Error('recommendations must be an array.');
  }

  return summary;
}

function normalizeRecommendations(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  if (typeof value === 'string') {
    const split = value
      .split(/\n|;|\|/) 
      .map((item) => item.replace(/^[-*\d.)\s]+/, '').trim())
      .filter(Boolean)
      .slice(0, 8);
    return split;
  }

  return [];
}

function normalizeModelSummary(summary, fallback) {
  const normalized = { ...(summary || {}) };

  normalized.window = {
    from: normalized?.window?.from || fallback.fromIso,
    to: normalized?.window?.to || fallback.toIso,
    hours: Number.isFinite(Number(normalized?.window?.hours))
      ? Number(normalized.window.hours)
      : fallback.hours
  };

  normalized.totals = { ...fallback.totals };
  normalized.eventTotals = { ...fallback.eventTotals };

  normalized.sources = Array.isArray(normalized.sources) ? normalized.sources : fallback.sources;
  normalized.topFailures = Array.isArray(normalized.topFailures) ? normalized.topFailures : fallback.topFailures;

  normalized.summaryText = fallback.summaryTextSeed;

  normalized.recommendations = normalizeRecommendations(normalized.recommendations);
  if (normalized.recommendations.length === 0) {
    normalized.recommendations = [
      'Review recurring failed tests and prioritize triage for the highest-frequency failures.'
    ];
  }

  const confidence = String(normalized.confidence || '').toLowerCase().trim();
  normalized.confidence = ['low', 'medium', 'high'].includes(confidence) ? confidence : 'medium';

  return normalized;
}

function truncateText(value, maxLength = 140) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function extractTestIdFromName(name = '') {
  if (typeof name !== 'string') return null;
  const match = name.match(/\[([A-Za-z0-9-]+)\]/);
  return match ? match[1] : null;
}

function classifyTestOutcome(entry) {
  if (entry.failed > 0 && entry.passed === 0) return 'failed';
  if (entry.failed > 0 && entry.passed > 0) return 'passed_flaky';
  if (entry.passed > 0) return 'passed';
  if (entry.warning > 0) return 'warning';
  return 'info';
}

function buildDeterministicSummaryText({ testTotals, hours }) {
  return `${hours}h test summary by test ID: ${testTotals.tests} unique tests assessed; ` +
    `${testTotals.passed} passed, ${testTotals.failed} failed, ${testTotals.flaky} passed but flaky.`;
}

function compactAnalyticsForPrompt(items) {
  const eventTotals = { events: 0, passed: 0, failed: 0, warning: 0, info: 0 };
  const sourceMap = new Map();
  const testMap = new Map();

  let noTestIdEvents = 0;

  for (const item of items) {
    const status = String(item?.status || 'info').toLowerCase();
    const source = String(item?.source || 'unknown').toLowerCase();
    const suite = String(item?.suite || 'n/a');
    const testName = String(item?.testName || 'n/a');
    const testId = item?.testId || extractTestIdFromName(testName);

    eventTotals.events += 1;
    if (status in eventTotals) eventTotals[status] += 1;

    const sourceRow = sourceMap.get(source) || { name: source, events: 0, failed: 0 };
    sourceRow.events += 1;
    if (status === 'failed') sourceRow.failed += 1;
    sourceMap.set(source, sourceRow);

    if (!testId) {
      noTestIdEvents += 1;
      continue;
    }

    const existing = testMap.get(testId) || {
      testId,
      testName,
      suite,
      passed: 0,
      failed: 0,
      warning: 0,
      info: 0,
      latestMessage: ''
    };

    if (status in existing) existing[status] += 1;
    existing.latestMessage = truncateText(item?.text, 160) || existing.latestMessage;
    testMap.set(testId, existing);
  }

  const classifiedTests = [...testMap.values()].map((entry) => ({
    ...entry,
    classification: classifyTestOutcome(entry)
  }));

  const testTotals = {
    tests: classifiedTests.length,
    events: classifiedTests.length,
    passed: classifiedTests.filter((entry) => entry.classification === 'passed' || entry.classification === 'passed_flaky').length,
    failed: classifiedTests.filter((entry) => entry.classification === 'failed').length,
    flaky: classifiedTests.filter((entry) => entry.classification === 'passed_flaky').length,
    warning: classifiedTests.filter((entry) => entry.classification === 'warning').length,
    info: classifiedTests.filter((entry) => entry.classification === 'info').length,
    noTestIdEvents
  };

  const sources = [...sourceMap.values()]
    .sort((a, b) => b.events - a.events || b.failed - a.failed)
    .slice(0, 8);

  const topFailures = classifiedTests
    .filter((entry) => entry.failed > 0)
    .sort((a, b) => b.failed - a.failed || b.passed - a.passed)
    .slice(0, 8);

  const failedSamples = items
    .filter((item) => String(item?.status || '').toLowerCase() === 'failed')
    .slice(0, 8)
    .map((item) => ({
      source: item.source || 'unknown',
      suite: item.suite || 'n/a',
      testName: item.testName || 'n/a',
      message: truncateText(item.text, 120)
    }));

  const recentSamples = items
    .slice(0, 12)
    .map((item) => ({
      status: item.status || 'info',
      source: item.source || 'unknown',
      testName: item.testName || 'n/a',
      message: truncateText(item.text, 80)
    }));

  return {
    totals: testTotals,
    testTotals,
    eventTotals,
    sources,
    topFailures,
    failedSamples,
    recentSamples,
    summaryTextSeed: buildDeterministicSummaryText({ testTotals, hours: SUMMARY_HOURS })
  };
}

function buildSummaryPrompt({ fromIso, toIso, hours, analytics }) {
  return [
    `Generate a QA test run summary from the supplied Agent Smith analytics.`,
    '',
    `WINDOW: ${fromIso} to ${toIso} (${hours} hours)`,
    '',
    `RULES:`,
    `- Use only the provided data.`,
    `- Do not invent missing tests, counts, or causes.`,
    `- Return ONLY one JSON object.`,
    `- No markdown or code fences.`,
    '',
    `OUTPUT SCHEMA:`,
    `{`,
    `  "window": { "from": "ISO8601", "to": "ISO8601", "hours": number },`,
    `  "totals": { "tests": number, "events": number, "passed": number, "failed": number, "flaky": number, "warning": number, "info": number, "noTestIdEvents": number },`,
    `  "sources": [ { "name": "string", "events": number, "failed": number } ],`,
    `  "topFailures": [ { "testId": "string", "testName": "string", "suite": "string", "failed": number, "passed": number, "classification": "failed|passed_flaky", "latestMessage": "string" } ],`,
    `  "summaryText": "string",`,
    `  "recommendations": ["string"],`,
    `  "confidence": "low|medium|high"`,
    `}`,
    '',
    `INPUT_ANALYTICS:`,
    JSON.stringify(analytics)
  ].join('\n');
}

async function fetchTestResultEvents(hours) {
  const query = new URLSearchParams({
    limit: '500',
    hours: String(hours),
    eventType: 'test_result'
  });

  const url = `${API_URL}/api/agent-smith/messages?${query.toString()}`;
  console.log(`Fetching events from ${url}...`);

  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fetch events (${response.status}): ${body}`);
  }

  const data = await response.json();
  const items = Array.isArray(data.items) ? data.items : [];
  return items;
}

async function main() {
  const outputDir = await resolveWritableOutputDir();
  const now = new Date();
  const from = new Date(now.getTime() - SUMMARY_HOURS * 60 * 60 * 1000);

  const events = await fetchTestResultEvents(SUMMARY_HOURS);
  console.log(`Loaded ${events.length} test_result events for ${SUMMARY_HOURS}h window.`);

  const eventsPath = path.join(outputDir, 'agent-smith-events-24h.json');
  await fs.writeFile(eventsPath, JSON.stringify(events, null, 2));

  const promptAnalytics = compactAnalyticsForPrompt(events);
  const prompt = buildSummaryPrompt({
    fromIso: from.toISOString(),
    toIso: now.toISOString(),
    hours: SUMMARY_HOURS,
    analytics: promptAnalytics
  });

  let rawSummary;
  try {
    rawSummary = await callChatCompletion({
      url: OLLAMA_COMPLETION_URL,
      model: OLLAMA_MODEL,
      maxTokens: Number(process.env.OLLAMA_N_PREDICT || 1200),
      temperature: Number(process.env.OLLAMA_TEMPERATURE || 0.2),
      systemPrompt: 'You are a JSON-only API for QA test analytics. Return only valid JSON object.',
      userPrompt: prompt,
      label: 'agent-smith-summary'
    });
  } catch (error) {
    const message = String(error?.message || '');
    if (!message.includes('exceed_context_size_error') && !message.includes('exceeds the available context size')) {
      throw error;
    }

    console.warn('Prompt exceeded model context. Retrying with ultra-compact analytics payload...');
    const ultraCompact = {
      totals: promptAnalytics.totals,
      sources: promptAnalytics.sources.slice(0, 4),
      topFailures: promptAnalytics.topFailures.slice(0, 4),
      failedSamples: promptAnalytics.failedSamples.slice(0, 3),
      recentSamples: promptAnalytics.recentSamples.slice(0, 4)
    };

    const compactPrompt = buildSummaryPrompt({
      fromIso: from.toISOString(),
      toIso: now.toISOString(),
      hours: SUMMARY_HOURS,
      analytics: ultraCompact
    });

    rawSummary = await callChatCompletion({
      url: OLLAMA_COMPLETION_URL,
      model: OLLAMA_MODEL,
      maxTokens: Number(process.env.OLLAMA_N_PREDICT || 1200),
      temperature: Number(process.env.OLLAMA_TEMPERATURE || 0.2),
      systemPrompt: 'You are a JSON-only API for QA test analytics. Return only valid JSON object.',
      userPrompt: compactPrompt,
      label: 'agent-smith-summary-retry'
    });
  }

  const rawPath = path.join(outputDir, 'agent-smith-summary-raw.json');
  await fs.writeFile(rawPath, rawSummary);

  const parsedSummary = parseModelJsonObject(rawSummary);
  const normalizedSummary = normalizeModelSummary(parsedSummary, {
    fromIso: from.toISOString(),
    toIso: now.toISOString(),
    hours: SUMMARY_HOURS,
    totals: promptAnalytics.totals,
    eventTotals: promptAnalytics.eventTotals,
    sources: promptAnalytics.sources,
    topFailures: promptAnalytics.topFailures,
    summaryTextSeed: promptAnalytics.summaryTextSeed
  });
  const finalSummary = validateSummary(normalizedSummary);
  const finalPath = path.join(outputDir, 'agent-smith-summary-final.json');
  await fs.writeFile(finalPath, JSON.stringify(finalSummary, null, 2));

  console.log(`Summary saved to ${finalPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
