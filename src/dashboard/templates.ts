import type { ExecutionStep, Route } from '../types.js';

export function layout(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - Slapture Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
    }
    nav {
      background: #333;
      padding: 1rem 2rem;
      display: flex;
      gap: 2rem;
      align-items: center;
    }
    nav a {
      color: #fff;
      text-decoration: none;
      padding: 0.5rem 1rem;
      border-radius: 4px;
    }
    nav a:hover { background: #444; }
    nav a.active { background: #007aff; }
    .logo { font-weight: bold; font-size: 1.25rem; margin-right: auto; }
    main { padding: 2rem; max-width: 1200px; margin: 0 auto; }
    h1 { margin-bottom: 1.5rem; color: #333; }
    .card {
      background: white;
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 1rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 500;
    }
    .badge-success { background: #d4edda; color: #155724; }
    .badge-warning { background: #fff3cd; color: #856404; }
    .badge-danger { background: #f8d7da; color: #721c24; }
    .badge-info { background: #cce5ff; color: #004085; }
    .badge-secondary { background: #e2e3e5; color: #383d41; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #eee; }
    th { font-weight: 500; color: #666; }
    .btn {
      display: inline-block;
      padding: 0.5rem 1rem;
      border-radius: 4px;
      text-decoration: none;
      font-size: 0.875rem;
      cursor: pointer;
      border: none;
    }
    .btn-primary { background: #007aff; color: white; }
    .btn-secondary { background: #6c757d; color: white; }
    .btn-danger { background: #6c757d; color: white; }
    .btn-danger:hover { background: #dc3545; }
    .btn:hover { opacity: 0.9; }
    .filter-bar {
      display: flex;
      gap: 1rem;
      margin-bottom: 1rem;
      flex-wrap: wrap;
    }
    .filter-bar select, .filter-bar input {
      padding: 0.5rem;
      border: 1px solid #ddd;
      border-radius: 4px;
    }
    .text-muted { color: #666; }
    .text-truncate {
      max-width: 300px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .empty-state {
      text-align: center;
      padding: 3rem;
      color: #666;
    }
    .llm-card { border-left: 4px solid #ccc; }
    .llm-card-validator { border-left-color: #007aff; }
    .llm-card-mastermind { border-left-color: #8b5cf6; }
    .llm-card-evolver { border-left-color: #10b981; }
    .llm-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
    .llm-section { margin-top: 1rem; }
    .llm-section h4 { font-size: 0.875rem; color: #666; margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .badge-validator { background: #cce5ff; color: #004085; }
    .badge-mastermind { background: #ede9fe; color: #5b21b6; }
    .badge-evolver { background: #d1fae5; color: #065f46; }
    details.llm-raw { margin-top: 0.75rem; }
    details.llm-raw summary { cursor: pointer; font-size: 0.875rem; color: #666; padding: 0.25rem 0; }
    details.llm-raw summary:hover { color: #333; }
    details.llm-raw pre { margin-top: 0.5rem; background: #1e1e1e; color: #d4d4d4; padding: 1rem; border-radius: 4px; overflow-x: auto; font-size: 0.75rem; max-height: 500px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <nav>
    <a href="/widget" class="logo">Slapture</a>
    <a href="/dashboard">Home</a>
    <a href="/dashboard/captures">Captures</a>
    <a href="/dashboard/routes">Routes</a>
    <a href="/dashboard/reviews">Reviews</a>
    <a href="/dashboard/auth">Integrations</a>
    <a href="/dashboard/api-keys">API Keys</a>
    <a href="/dashboard/test-suite">Test Suite</a>
  </nav>
  <main>
    ${content}
  </main>
</body>
</html>`;
}

export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, c => map[c]);
}

export function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function statusBadge(status: string): string {
  const classes: Record<string, string> = {
    success: 'badge-success',
    failed: 'badge-danger',
    pending: 'badge-warning',
    rejected: 'badge-secondary',
    blocked_needs_auth: 'badge-warning',
    blocked_auth_expired: 'badge-danger',
  };
  const labels: Record<string, string> = {
    success: 'Success',
    failed: 'Failed',
    pending: 'Pending',
    rejected: 'Rejected',
    blocked_needs_auth: 'Needs Auth',
    blocked_auth_expired: 'Auth Expired',
  };
  return `<span class="badge ${classes[status] || 'badge-secondary'}">${labels[status] || status}</span>`;
}

export function verificationBadge(state: string): string {
  const classes: Record<string, string> = {
    human_verified: 'badge-success',
    ai_certain: 'badge-info',
    ai_uncertain: 'badge-warning',
    failed: 'badge-danger',
    pending: 'badge-secondary',
  };
  const labels: Record<string, string> = {
    human_verified: 'Verified',
    ai_certain: 'AI Certain',
    ai_uncertain: 'AI Uncertain',
    failed: 'Failed',
    pending: 'Pending',
  };
  return `<span class="badge ${classes[state] || 'badge-secondary'}">${labels[state] || state}</span>`;
}

const LLM_STEPS = ['route_validate', 'mastermind', 'evolve'] as const;

type LlmStepType = typeof LLM_STEPS[number];

const STEP_LABELS: Record<LlmStepType, string> = {
  route_validate: 'Validator',
  mastermind: 'Mastermind',
  evolve: 'Evolver',
};

const STEP_CARD_CLASS: Record<LlmStepType, string> = {
  route_validate: 'llm-card-validator',
  mastermind: 'llm-card-mastermind',
  evolve: 'llm-card-evolver',
};

const STEP_BADGE_CLASS: Record<LlmStepType, string> = {
  route_validate: 'badge-validator',
  mastermind: 'badge-mastermind',
  evolve: 'badge-evolver',
};

function confidenceBadgeClass(confidence: string): string {
  if (confidence === 'certain' || confidence === 'confident') return 'badge-success';
  if (confidence === 'plausible' || confidence === 'unsure') return 'badge-warning';
  if (confidence === 'doubtful' || confidence === 'reject') return 'badge-danger';
  return 'badge-secondary';
}

function mastermindActionBadgeClass(action: string): string {
  if (action === 'route') return 'badge-success';
  if (action === 'create') return 'badge-info';
  if (action === 'clarify') return 'badge-warning';
  if (action === 'inbox') return 'badge-secondary';
  return 'badge-secondary';
}

function evolverActionBadgeClass(action: string): string {
  if (action === 'evolved') return 'badge-success';
  if (action === 'skipped') return 'badge-secondary';
  if (action === 'failed') return 'badge-danger';
  return 'badge-secondary';
}

function safe(value: unknown): string {
  if (value === null || value === undefined) return '';
  return escapeHtml(String(value));
}

function renderValidatorCard(step: ExecutionStep): string {
  const inp = step.input as Record<string, unknown> | null;
  const out = step.output as Record<string, unknown> | null;

  const routeId = safe(inp?.routeId);
  const trigger = safe(inp?.trigger);
  const inputText = safe(inp?.input);

  const confidence = String(out?.confidence ?? '');
  const reasoning = safe(out?.reasoning);
  const promptUsed = safe(out?.promptUsed);

  let sawHtml = '';
  sawHtml += `<div><strong>Route:</strong> ${routeId}</div>`;
  sawHtml += `<div><strong>Trigger:</strong> ${trigger}</div>`;
  sawHtml += `<div><strong>Input:</strong> ${inputText}</div>`;

  let decidedHtml = '';
  decidedHtml += `<div><strong>Confidence:</strong> <span class="badge ${confidenceBadgeClass(confidence)}">${safe(confidence)}</span></div>`;
  decidedHtml += `<div><strong>Reasoning:</strong> ${reasoning}</div>`;

  return renderCardSections(sawHtml, decidedHtml, promptUsed, safe(JSON.stringify(out, null, 2)));
}

function renderMastermindCard(step: ExecutionStep): string {
  const inp = step.input as Record<string, unknown> | null;
  const out = step.output as Record<string, unknown> | null;
  const dynInput = (inp?.dynamicInput ?? {}) as Record<string, unknown>;
  const staticPrompt = safe(inp?.staticPrompt);

  const raw = safe(dynInput.raw);
  const dispatcherReason = safe(dynInput.dispatcherReason);
  const routes = (dynInput.routesSnapshot ?? []) as Array<Record<string, unknown>>;

  let sawHtml = '';
  sawHtml += `<div><strong>Input:</strong> ${raw}</div>`;
  sawHtml += `<div><strong>Dispatcher reason:</strong> ${dispatcherReason}</div>`;
  if (routes.length > 0) {
    sawHtml += `<table><thead><tr><th>Name</th><th>Description</th><th>Triggers</th><th>Recent Items</th></tr></thead><tbody>`;
    for (const r of routes) {
      const triggers = Array.isArray(r.triggers) ? r.triggers : [];
      const recentItems = Array.isArray(r.recentItems) ? r.recentItems : [];
      sawHtml += `<tr><td>${safe(r.name)}</td><td>${safe(r.description)}</td><td>${triggers.length}</td><td>${recentItems.length}</td></tr>`;
    }
    sawHtml += `</tbody></table>`;
  }

  const action = String(out?.action ?? '');
  let decidedHtml = '';
  decidedHtml += `<div><strong>Action:</strong> <span class="badge ${mastermindActionBadgeClass(action)}">${safe(action)}</span></div>`;
  if (out?.routeId) decidedHtml += `<div><strong>Route ID:</strong> ${safe(out.routeId)}</div>`;
  if (out?.route) decidedHtml += `<div><strong>New route:</strong> ${safe((out.route as Record<string, unknown>).name)}</div>`;
  if (out?.question) decidedHtml += `<div><strong>Question:</strong> ${safe(out.question)}</div>`;
  decidedHtml += `<div><strong>Reasoning:</strong> ${safe(out?.reason)}</div>`;

  return renderCardSections(sawHtml, decidedHtml, staticPrompt, safe(JSON.stringify(out, null, 2)));
}

function renderEvolverCard(step: ExecutionStep): string {
  const inp = step.input as Record<string, unknown> | null;
  const out = step.output as Record<string, unknown> | null;
  const dynInput = (inp?.dynamicInput ?? {}) as Record<string, unknown>;
  const staticPrompt = safe(inp?.staticPrompt);
  const routeSnap = (dynInput.routeSnapshot ?? {}) as Record<string, unknown>;

  let sawHtml = '';
  sawHtml += `<div><strong>Route:</strong> ${safe(routeSnap.name)} - ${safe(routeSnap.description)}</div>`;
  sawHtml += `<div><strong>New input:</strong> ${safe(dynInput.newInput)}</div>`;
  sawHtml += `<div><strong>Mastermind reason:</strong> ${safe(dynInput.mastermindReason)}</div>`;
  sawHtml += `<div><strong>Attempt:</strong> ${safe(dynInput.attempt)}</div>`;

  const existingTriggers = Array.isArray(routeSnap.triggers) ? routeSnap.triggers as Array<Record<string, unknown>> : [];
  if (existingTriggers.length > 0) {
    sawHtml += `<div><strong>Existing triggers:</strong></div><table><thead><tr><th>Pattern</th><th>Priority</th></tr></thead><tbody>`;
    for (const t of existingTriggers) {
      sawHtml += `<tr><td>${safe(t.pattern)}</td><td>${safe(t.priority)}</td></tr>`;
    }
    sawHtml += `</tbody></table>`;
  }

  const recentItems = Array.isArray(routeSnap.recentItems) ? routeSnap.recentItems as Array<Record<string, unknown>> : [];
  if (recentItems.length > 0) {
    sawHtml += `<div><strong>Recent matches:</strong></div><ul>`;
    for (const item of recentItems) {
      sawHtml += `<li>${safe(item.raw)}</li>`;
    }
    sawHtml += `</ul>`;
  }

  if (dynInput.validationFailure) {
    sawHtml += `<div><strong>Validation failure:</strong> ${safe(dynInput.validationFailure)}</div>`;
  }

  const action = String(out?.action ?? '');
  let decidedHtml = '';
  decidedHtml += `<div><strong>Action:</strong> <span class="badge ${evolverActionBadgeClass(action)}">${safe(action)}</span></div>`;
  decidedHtml += `<div><strong>Reasoning:</strong> ${safe(out?.reasoning)}</div>`;

  const proposedTriggers = Array.isArray(out?.triggers) ? out.triggers as Array<Record<string, unknown>> : [];
  if (proposedTriggers.length > 0) {
    decidedHtml += `<div><strong>Proposed triggers:</strong></div><table><thead><tr><th>Pattern</th><th>Priority</th></tr></thead><tbody>`;
    for (const t of proposedTriggers) {
      decidedHtml += `<tr><td>${safe(t.pattern)}</td><td>${safe(t.priority)}</td></tr>`;
    }
    decidedHtml += `</tbody></table>`;
  }

  if (out?.validationPassed !== undefined) {
    decidedHtml += `<div><strong>Validation:</strong> ${out.validationPassed ? 'Passed' : 'Failed'}</div>`;
  }
  if (out?.retriesUsed !== undefined) {
    decidedHtml += `<div><strong>Retries used:</strong> ${safe(out.retriesUsed)}</div>`;
  }

  return renderCardSections(sawHtml, decidedHtml, staticPrompt, safe(JSON.stringify(out, null, 2)));
}

function renderCardSections(sawHtml: string, decidedHtml: string, rawPrompt: string, rawResponse: string): string {
  let html = '';
  html += `<div class="llm-section"><h4>What it saw</h4>${sawHtml}</div>`;
  html += `<div class="llm-section"><h4>What it decided</h4>${decidedHtml}</div>`;
  html += `<details class="llm-raw"><summary>Raw Prompt</summary><pre>${rawPrompt}</pre></details>`;
  html += `<details class="llm-raw"><summary>Raw Response</summary><pre>${rawResponse}</pre></details>`;
  return html;
}

function renderSimpleStep(step: ExecutionStep, route: Route | null): string {
  const out = (step.output || {}) as Record<string, unknown>;
  const inp = (step.input || {}) as Record<string, unknown>;

  if (step.step === 'parse') {
    const payload = safe(inp.raw || out.payload || (out as Record<string, unknown>).payload);
    const explicit = out.explicitRoute ? `<span class="badge badge-info">explicit: ${safe(out.explicitRoute)}</span>` : '';
    return `<div style="display: flex; gap: 0.75rem; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid #eee;">
      <strong style="min-width: 5rem;">Parse</strong>
      <span class="text-muted">${step.durationMs}ms</span>
      ${explicit}
    </div>`;
  }

  if (step.step === 'dispatch') {
    const reason = safe(out.reason);
    const routeId = out.routeId ? safe(out.routeId) : '<em>no match</em>';
    const confidence = out.confidence ? `<span class="badge badge-secondary">${safe(out.confidence)}</span>` : '';
    return `<div style="display: flex; gap: 0.75rem; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid #eee;">
      <strong style="min-width: 5rem;">Dispatch</strong>
      <span class="text-muted">${step.durationMs}ms</span>
      ${confidence}
      <span>${routeId}</span>
      <span class="text-muted">${reason}</span>
    </div>`;
  }

  if (step.step === 'execute') {
    const status = out.status ? safe(out.status) : '';
    const error = out.error ? `<span class="badge badge-danger">${safe(out.error)}</span>` : '';
    let routeInfo = '';
    if (route) {
      routeInfo = `<span><strong>${safe(route.name)}</strong> → <span class="badge badge-info">${safe(route.destinationType)}</span></span>`;
    }
    return `<div style="display: flex; gap: 0.75rem; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid #eee; flex-wrap: wrap;">
      <strong style="min-width: 5rem;">Execute</strong>
      <span class="text-muted">${step.durationMs}ms</span>
      ${routeInfo}
      ${status ? `<span class="badge badge-success">${status}</span>` : ''}
      ${error}
    </div>`;
  }

  return '';
}

export function renderPipeline(steps: ExecutionStep[], route: Route | null): string {
  if (steps.length === 0) return '';

  let html = `<div class="card"><h3>Pipeline</h3>`;

  for (const step of steps) {
    if ((LLM_STEPS as readonly string[]).includes(step.step)) {
      const stepType = step.step as LlmStepType;
      const label = STEP_LABELS[stepType];
      const cardClass = STEP_CARD_CLASS[stepType];
      const badgeClass = STEP_BADGE_CLASS[stepType];

      html += `<div class="card llm-card ${cardClass}">`;
      html += `<div class="llm-header">`;
      html += `<span class="badge ${badgeClass}">${label}</span>`;
      html += `<span class="text-muted">${step.durationMs}ms</span>`;
      html += `</div>`;

      if (stepType === 'route_validate') {
        html += renderValidatorCard(step);
      } else if (stepType === 'mastermind') {
        html += renderMastermindCard(step);
      } else if (stepType === 'evolve') {
        html += renderEvolverCard(step);
      }

      html += `</div>`;
    } else {
      html += renderSimpleStep(step, route);
    }
  }

  html += `</div>`;
  return html;
}

// Keep old name as alias for backwards compatibility with tests
export const renderLlmInteractions = (steps: ExecutionStep[], _token: string) => renderPipeline(steps, null);
