import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');

function detectGitBranchFromWorkspace() {
  try {
    const branch = execSync(`git -C "${path.join(workspaceRoot, 'selenium_cucumber_serenity')}" rev-parse --abbrev-ref HEAD`, {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8'
    }).trim();

    if (!branch || branch.toUpperCase() === 'HEAD') {
      return '';
    }

    return branch.replace(/^refs\/heads\//, '');
  } catch {
    return '';
  }
}

const webhookUrl = process.env.AGENT_SMITH_WEBHOOK_URL;
const webhookSecret = process.env.AGENT_SMITH_WEBHOOK_SECRET;
const source = 'serenity';
const gitBranch = (
  process.env.AGENT_SMITH_GIT_BRANCH
  || process.env.GIT_BRANCH
  || process.env.BRANCH_NAME
  || detectGitBranchFromWorkspace()
  || ''
).replace(/^refs\/heads\//, '');
const cucumberJsonPath = process.env.CUCUMBER_JSON_PATH
  || path.join(workspaceRoot, 'selenium_cucumber_serenity', 'target', 'cucumber.json');
const runId = process.env.AGENT_SMITH_RUN_ID || `serenity-${new Date().toISOString().replace(/[:.]/g, '-')}`;

if (!webhookUrl || !webhookSecret) {
  console.log('⚠ Agent Smith webhook not configured; skipping event publishing.');
  process.exit(0);
}

function getScenarioStatus(steps = []) {
  if (!steps.length) return 'info';

  const statuses = steps
    .map(step => step?.result?.status || '')
    .map(status => status.toLowerCase());

  if (statuses.some(status => status === 'failed' || status === 'undefined' || status === 'ambiguous')) {
    return 'failed';
  }

  if (statuses.some(status => status === 'skipped' || status === 'pending')) {
    return 'warning';
  }

  if (statuses.every(status => status === 'passed')) {
    return 'passed';
  }

  return 'info';
}

function extractTestIdFromName(name = '') {
  const match = name.match(/\[([A-Za-z0-9-]+)\]/);
  return match ? match[1] : null;
}

async function sendEvent(payload) {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-agent-smith-secret': webhookSecret
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Webhook ${response.status}: ${text}`);
  }
}

function buildScenarioEvent(feature, scenario) {
  const scenarioName = scenario.name || 'Unnamed scenario';
  const status = getScenarioStatus(scenario.steps || []);
  const firstFailedStep = (scenario.steps || []).find(step => (step?.result?.status || '').toLowerCase() === 'failed');
  const text = status === 'failed'
    ? firstFailedStep?.result?.error_message || `Scenario failed: ${scenarioName}`
    : `Scenario ${status}: ${scenarioName}`;
  const testId = extractTestIdFromName(scenarioName);

  return {
    source,
    eventType: 'test_result',
    status,
    runId,
    suite: feature.name || 'Unnamed feature',
    testName: scenarioName,
    text,
    timestamp: new Date().toISOString(),
    meta: {
      featureUri: feature.uri,
      scenarioId: scenario.id,
      testId,
      tags: (scenario.tags || []).map(tag => tag.name),
      buildUrl: process.env.BUILD_URL || '',
      gitBranch
    }
  };
}

function buildSummaryEvent(summary) {
  const status = summary.failed > 0 ? 'failed' : 'passed';
  return {
    source,
    eventType: 'test_result',
    status,
    runId,
    suite: 'Serenity run summary',
    testName: 'Execution summary',
    text: `Serenity run complete: passed=${summary.passed}, failed=${summary.failed}, warning=${summary.warning}, total=${summary.total}`,
    timestamp: new Date().toISOString(),
    meta: {
      summary,
      buildUrl: process.env.BUILD_URL || '',
      gitBranch
    }
  };
}

async function main() {
  try {
    const raw = await fs.readFile(cucumberJsonPath, 'utf-8');
    const features = JSON.parse(raw);
    if (!Array.isArray(features) || features.length === 0) {
      console.log('⚠ No cucumber scenarios found; nothing to publish.');
      return;
    }

    const scenarioEvents = [];
    const summary = { passed: 0, failed: 0, warning: 0, info: 0, total: 0 };

    for (const feature of features) {
      const scenarios = Array.isArray(feature.elements) ? feature.elements : [];
      for (const scenario of scenarios) {
        const elementType = (scenario.type || '').toLowerCase();
        if (elementType && elementType !== 'scenario' && elementType !== 'scenario_outline') {
          continue;
        }

        if (!scenario.name || !scenario.name.trim()) {
          continue;
        }

        const payload = buildScenarioEvent(feature, scenario);
        scenarioEvents.push(payload);
        summary[payload.status] += 1;
        summary.total += 1;
      }
    }

    for (const eventPayload of scenarioEvents) {
      try {
        await sendEvent(eventPayload);
      } catch (error) {
        console.error(`⚠ Failed to send scenario event (${eventPayload.testName}): ${error.message}`);
      }
    }

    try {
      await sendEvent(buildSummaryEvent(summary));
    } catch (error) {
      console.error(`⚠ Failed to send summary event: ${error.message}`);
    }

    console.log(`✅ Agent Smith publishing complete for runId=${runId}. Events attempted: ${scenarioEvents.length + 1}`);
  } catch (error) {
    console.error(`⚠ Could not process Serenity results for Agent Smith: ${error.message}`);
  }
}

main();