import { CHAR_NAMES, USE_AGENT_TOWN_MOCK } from '../config/constants';

const STATUS_PLAN = [
  'running', 'running', 'running', 'running', 'running',
  'running', 'running', 'running', 'running', 'running', 'running',
  'idle', 'idle', 'idle', 'idle',
  'pending', 'pending', 'pending',
  'offline', 'offline',
];

const MODEL_POOL = [
  { provider: 'anthropic', model: 'claude-sonnet-4', channel: 'webchat', reasoning: true, contextWindow: 200000 },
  { provider: 'openai', model: 'gpt-4o', channel: 'slack', reasoning: true, contextWindow: 128000 },
  { provider: 'google', model: 'gemini-2.0-flash', channel: 'discord', reasoning: false, contextWindow: 1048576 },
  { provider: 'openai', model: 'gpt-4.1-mini', channel: 'cli', reasoning: true, contextWindow: 128000 },
  { provider: 'anthropic', model: 'claude-3-5-haiku', channel: 'feishu', reasoning: false, contextWindow: 200000 },
  { provider: 'google', model: 'gemini-2.5-pro', channel: 'webchat', reasoning: true, contextWindow: 1048576 },
  { provider: 'openai', model: 'o3-mini', channel: 'slack', reasoning: true, contextWindow: 200000 },
  { provider: 'anthropic', model: 'claude-opus-4', channel: 'webchat', reasoning: true, contextWindow: 200000 },
];

const WORKSTREAMS = [
  {
    area: 'Auth Hardening',
    prompt: 'Audit the session middleware and remove the remaining auth bypass edge cases.',
    planning: 'I mapped the middleware chain and isolated the unsafe cookie refresh path.',
    running: 'I am patching the middleware and validating replay, expiry, and role escalation flows.',
    success: 'The auth bypass is closed and the regression suite now covers session rotation correctly.',
    waiting: 'I need approval before applying the migration that invalidates older refresh tokens.',
    error: 'The patch exposed a legacy dependency on unsigned cookies, so I rolled back and isolated the blast radius.',
    tools: ['read_file', 'search_codebase', 'execute_shell_command'],
  },
  {
    area: 'Payments Regression',
    prompt: 'Run the payment refund regression plan against the current checkout branch.',
    planning: 'I rebuilt the refund matrix and queued the flaky integration cases first.',
    running: 'Tests are still running; I am comparing provider callbacks against the new idempotency logic.',
    success: 'Refund retries now pass end-to-end and the duplicate callback case is covered.',
    waiting: 'The external sandbox is rate-limiting our test account, so I am waiting on a temporary quota bump.',
    error: 'One refund path still deadlocks when the webhook arrives before the ledger write completes.',
    tools: ['execute_shell_command', 'read_file', 'run_query'],
  },
  {
    area: 'API Gateway Deploy',
    prompt: 'Prepare and deploy the API gateway canary to staging with rollback notes.',
    planning: 'I staged the manifests and verified the rollout windows with the SRE checklist.',
    running: 'Canary is serving a partial traffic slice while I watch latency and 5xx deltas.',
    success: 'The canary stayed healthy for the full window and the staged deploy is now complete.',
    waiting: 'I need the release captain to approve the final production handoff window.',
    error: 'The new gateway image failed health checks because the service mesh sidecar never became ready.',
    tools: ['execute_shell_command', 'deploy_service', 'send_notification'],
  },
  {
    area: 'Observability Sweep',
    prompt: 'Review the alert thresholds for the worker fleet and tune the noisy ones.',
    planning: 'I grouped the alerts by symptom and compared them with the last seven days of incidents.',
    running: 'I am tuning CPU, queue depth, and retry alerts against the latest baseline traffic.',
    success: 'The noisy worker alerts are tuned and the on-call page volume dropped in replay.',
    waiting: 'I am waiting for the overnight batch to finish before validating the new thresholds.',
    error: 'The metrics series from one worker shard is incomplete, so the tuning pass needs a manual follow-up.',
    tools: ['run_query', 'read_file', 'search_codebase'],
  },
  {
    area: 'Database Latency',
    prompt: 'Trace the slow dashboard queries and recommend the minimum safe fix.',
    planning: 'I narrowed the issue to two joins and the missing partial index on tenant filters.',
    running: 'I am replaying the slow query sample set after applying index candidates in staging.',
    success: 'The partial index dropped the worst-case query from 2.8s to 190ms in replay.',
    waiting: 'I need DBA approval before creating the index on the largest tenant partition.',
    error: 'The first optimization changed the query plan for archival reads, so I reverted that candidate.',
    tools: ['run_query', 'read_file', 'execute_shell_command'],
  },
  {
    area: 'Legacy Middleware Refactor',
    prompt: 'Refactor the error middleware without changing the public API contract.',
    planning: 'I mapped the legacy branching paths and found three duplicate fallback handlers.',
    running: 'The middleware stack is mid-refactor while I keep the old response envelope intact.',
    success: 'The duplicate handlers are removed and the response contract stays byte-for-byte compatible.',
    waiting: 'I am waiting on a baseline trace capture before removing the final compatibility shim.',
    error: 'One refactor pass changed the order of side effects, so I restored the old behavior and isolated the diff.',
    tools: ['read_file', 'write_file', 'execute_shell_command'],
  },
  {
    area: 'Dependency Security',
    prompt: 'Scan the dependency tree for exploitable CVEs and patch only the urgent ones.',
    planning: 'I tagged the findings by exploitability and production exposure before changing versions.',
    running: 'Urgent packages are being upgraded while I verify transitive lockfile drift.',
    success: 'The high-risk CVEs are patched and the lockfile only changed in the targeted packages.',
    waiting: 'One package upgrade needs product approval because it changes the public upload contract.',
    error: 'A patched package broke the image pipeline, so I pinned it and opened a follow-up remediation track.',
    tools: ['search_codebase', 'install_package', 'execute_shell_command'],
  },
  {
    area: 'Image Pipeline',
    prompt: 'Find the throughput bottleneck in the image transformation workers.',
    planning: 'I profiled the hot path and the resize queue is the main source of backpressure.',
    running: 'I am benchmarking the worker pool after changing the chunking and decode strategy.',
    success: 'The worker pool now processes the same image batch 34% faster without extra memory spikes.',
    waiting: 'I am waiting on a larger production-like asset batch for the final throughput check.',
    error: 'The SIMD path crashed on malformed uploads, so I disabled it and captured the failing samples.',
    tools: ['execute_shell_command', 'run_query', 'read_file'],
  },
  {
    area: 'CI Pipeline',
    prompt: 'Stabilize the new CI template so all service repos can adopt it safely.',
    planning: 'I split the flaky steps from the deterministic ones and isolated the slowest matrix jobs.',
    running: 'The new pipeline is executing in parallel while I compare cache hits and job fanout.',
    success: 'The CI template is stable and the median pipeline time dropped by eight minutes.',
    waiting: 'I need repository admins to enable a new shared secret before rollout can finish.',
    error: 'The cache key strategy poisoned one artifact path, so I reverted that optimization.',
    tools: ['write_file', 'execute_shell_command', 'send_notification'],
  },
  {
    area: 'Realtime Memory Leak',
    prompt: 'Find the memory leak in the WebSocket pool and quantify the impact.',
    planning: 'I reproduced the leak under soak load and confirmed the issue is in connection cleanup.',
    running: 'I am validating the cleanup patch against a long-running socket churn scenario.',
    success: 'The leak is fixed and resident memory now plateaus after the churn test.',
    waiting: 'I am waiting for a longer soak run before calling the fix production-ready.',
    error: 'The first patch fixed the leak but regressed reconnect jitter, so I rewound and am testing a narrower fix.',
    tools: ['execute_shell_command', 'read_file', 'search_codebase'],
  },
  {
    area: 'Docs Sync',
    prompt: 'Refresh the API docs so the latest schema and examples are fully aligned.',
    planning: 'I diffed the generated spec against the deployed handlers and found stale examples.',
    running: 'The docs generator is running while I update examples for the changed endpoints.',
    success: 'Docs and examples now match the deployed schema across all public endpoints.',
    waiting: 'I need the SDK team to confirm one renamed field before publishing the updated examples.',
    error: 'The generated examples still leak an internal enum value, so I halted publication.',
    tools: ['read_file', 'write_file', 'execute_shell_command'],
  },
  {
    area: 'Traffic Rollout',
    prompt: 'Configure the load balancer policy for the next blue-green release.',
    planning: 'I aligned the rollout weights with the rollback thresholds and existing health alarms.',
    running: 'Traffic is shifting gradually while I monitor cold-start latency and sticky-session behavior.',
    success: 'The rollout policy is validated and rollback automation now triggers on the correct signals.',
    waiting: 'I am waiting for the release manager to unlock the final cutover window.',
    error: 'Sticky sessions broke for one edge region during rehearsal, so I disabled that route strategy.',
    tools: ['deploy_service', 'read_file', 'send_notification'],
  },
];

function isoFromNow(minutesAgo, seconds = 0) {
  return new Date(Date.now() - minutesAgo * 60_000 + seconds * 1000).toISOString();
}

function stableShortId(index) {
  return (0x71ac30 + index * 0x19f3).toString(16).slice(-8).toUpperCase();
}

function buildSessionIdentity(index) {
  const pid = stableShortId(index);
  const slug = pid.toLowerCase();
  return {
    id: `session-${slug}`,
    pid,
    sessionKey: `chat-${slug}-${(index + 17).toString(16)}`,
  };
}

function buildEventType(profile, ordinal) {
  const toolCount = 1 + (ordinal % Math.min(2, profile.tools.length - 1));
  return profile.tools.slice(0, toolCount + 1).join(', ');
}

function buildConversations(profile, status, agent, ordinal, startMinutesAgo) {
  const baseMinute = startMinutesAgo;
  const toolText = `${profile.tools[ordinal % profile.tools.length]}("${profile.area.toLowerCase().replace(/\s+/g, '-')}")`;
  const followupToolText = `${profile.tools[(ordinal + 1) % profile.tools.length]}("${agent.session_key}")`;

  const finalText = (
    status === 'running' ? profile.running
      : status === 'pending' ? profile.waiting
        : status === 'error' ? profile.error
          : profile.success
  );

  return [
    {
      role: 'user',
      text: profile.prompt,
      content_text: profile.prompt,
      timestamp: isoFromNow(baseMinute, 0),
    },
    {
      role: 'assistant',
      text: profile.planning,
      content_text: profile.planning,
      timestamp: isoFromNow(baseMinute, 22),
    },
    {
      role: 'tool',
      text: toolText,
      content_text: toolText,
      timestamp: isoFromNow(baseMinute, 45),
    },
    {
      role: 'tool',
      text: followupToolText,
      content_text: followupToolText,
      timestamp: isoFromNow(baseMinute, 64),
    },
    {
      role: 'assistant',
      text: finalText,
      content_text: finalText,
      timestamp: isoFromNow(baseMinute, 92),
    },
  ];
}

function buildEvent(agent, profile, status, ordinal, startMinutesAgo) {
  const duration = status === 'running' ? 420 + ordinal * 38 : 160 + ordinal * 27;
  const startTime = isoFromNow(startMinutesAgo, 0);
  const endTime = (
    status === 'running' || status === 'pending'
      ? isoFromNow(startMinutesAgo, 75)
      : new Date(new Date(startTime).getTime() + duration * 1000).toISOString()
  );

  return {
    event_id: `evt-${agent.pid.toLowerCase()}-${ordinal}`,
    agent_id: agent.id,
    agent_name: agent.name,
    event_type: buildEventType(profile, ordinal),
    status,
    start_time: startTime,
    end_time: endTime,
    duration,
    conversations: buildConversations(profile, status, agent, ordinal, startMinutesAgo),
  };
}

function buildTimeline(status, index) {
  if (status === 'running') {
    return index % 4 === 1
      ? ['ok', 'error', 'running']
      : index % 4 === 2
        ? ['ok', 'ok', 'ok', 'running']
        : ['ok', 'ok', 'running'];
  }

  if (status === 'idle') {
    return index % 2 === 0 ? ['ok', 'running', 'ok'] : ['error', 'ok', 'ok'];
  }

  if (status === 'pending') {
    return index % 2 === 0 ? ['ok', 'running', 'pending'] : ['ok', 'error', 'pending'];
  }

  return index % 2 === 0 ? ['ok', 'ok', 'error'] : ['error', 'ok'];
}

function latestOffsetByStatus(status, index) {
  if (status === 'running') return 4 + (index % 6) * 2;
  if (status === 'idle') return 18 + (index % 5) * 7;
  if (status === 'pending') return 7 + (index % 4) * 4;
  return 220 + index * 11;
}

function buildAgent(index) {
  const identity = buildSessionIdentity(index);
  const profile = MODEL_POOL[index % MODEL_POOL.length];
  const status = STATUS_PLAN[index] || 'running';
  const seenHours = 6 + index * 5;

  return {
    id: identity.id,
    name: `Agent-${identity.pid}`,
    pid: identity.pid,
    provider: profile.provider,
    model: profile.model,
    status,
    first_seen_at: new Date(Date.now() - seenHours * 3600_000).toISOString(),
    session_key: identity.sessionKey,
    channel: profile.channel,
    mock: true,
  };
}

function buildAgentEvents(agent, index) {
  const profile = WORKSTREAMS[index % WORKSTREAMS.length];
  const timeline = buildTimeline(agent.status, index);
  const latestOffset = latestOffsetByStatus(agent.status, index);

  return timeline.map((status, ordinal) => {
    const reverseOrdinal = timeline.length - ordinal - 1;
    const startMinutesAgo = latestOffset + reverseOrdinal * (42 + (index % 3) * 11);
    return buildEvent(agent, profile, status, ordinal, startMinutesAgo);
  });
}

function buildJourneyConversations(profile, index, step) {
  const baseMinute = 360 + index * 3 + (step + 1) * 18;
  return [
    {
      role: 'user',
      text: profile.prompt,
      content_text: profile.prompt,
      timestamp: isoFromNow(baseMinute),
    },
    {
      role: 'tool',
      text: `${profile.tools[step % profile.tools.length]}("journey-${index}-${step}")`,
      content_text: `${profile.tools[step % profile.tools.length]}("journey-${index}-${step}")`,
      timestamp: isoFromNow(baseMinute, 18),
    },
    {
      role: 'assistant',
      text: step % 5 === 4 ? profile.error : step % 4 === 3 ? profile.waiting : profile.success,
      content_text: step % 5 === 4 ? profile.error : step % 4 === 3 ? profile.waiting : profile.success,
      timestamp: isoFromNow(baseMinute, 42),
    },
  ];
}

export const MOCK_MODEL_PROVIDERS = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: [
      { id: 'anthropic/claude-sonnet-4', name: 'claude-sonnet-4', reasoning: true, contextWindow: 200000 },
      { id: 'anthropic/claude-opus-4', name: 'claude-opus-4', reasoning: true, contextWindow: 200000 },
      { id: 'anthropic/claude-3-5-haiku', name: 'claude-3-5-haiku', reasoning: false, contextWindow: 200000 },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    models: [
      { id: 'openai/gpt-4o', name: 'gpt-4o', reasoning: true, contextWindow: 128000 },
      { id: 'openai/gpt-4.1-mini', name: 'gpt-4.1-mini', reasoning: true, contextWindow: 128000 },
      { id: 'openai/o3-mini', name: 'o3-mini', reasoning: true, contextWindow: 200000 },
    ],
  },
  {
    id: 'google',
    name: 'Google',
    models: [
      { id: 'google/gemini-2.0-flash', name: 'gemini-2.0-flash', reasoning: false, contextWindow: 1048576 },
      { id: 'google/gemini-2.5-pro', name: 'gemini-2.5-pro', reasoning: true, contextWindow: 1048576 },
    ],
  },
];

export function generateMockData() {
  const count = Math.min(CHAR_NAMES.length, STATUS_PLAN.length);
  const agents = Array.from({ length: count }, (_, index) => buildAgent(index));
  const events = agents.flatMap((agent, index) => buildAgentEvents(agent, index));
  return { agents, events };
}

export function buildMockHistory(agent, events = []) {
  const latestEvents = [...events]
    .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))
    .slice(-3);

  const messages = latestEvents.flatMap((event, eventIndex) => (
    (event.conversations || [])
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg, msgIndex) => ({
        id: `mock-history-${agent?.id || 'agent'}-${eventIndex}-${msgIndex}`,
        role: msg.role,
        content: msg.text || msg.content_text || '',
        timestamp: msg.timestamp || event.start_time || new Date().toISOString(),
      }))
  ));

  return messages.slice(-12);
}

export function buildMockGuardResults(agents = [], events = []) {
  const latestByAgent = new Map();
  events.forEach((event) => {
    const prev = latestByAgent.get(event.agent_id);
    if (!prev || (event.start_time || '') > (prev.start_time || '')) {
      latestByAgent.set(event.agent_id, event);
    }
  });

  return agents
    .filter((agent) => agent.status === 'pending' || agent.status === 'running')
    .slice(0, 6)
    .map((agent, index) => {
      const latest = latestByAgent.get(agent.id);
      const unsafe = agent.status === 'pending' || index % 3 === 1;
      return {
        session_id: agent.id,
        mode: unsafe ? 'tool-check' : 'baseline',
        checked_at: Math.floor(Date.now() / 1000) - index * 173,
        verdict: unsafe ? 'unsafe' : 'safe',
        failure_mode: unsafe
          ? 'Potentially destructive write or external side effect requires human confirmation.'
          : 'No elevated risk found in the latest turn.',
        risk_source: latest?.event_type || 'chat',
        real_world_harm: unsafe ? 'Would modify production-adjacent state without explicit approval.' : '',
      };
    });
}

export function buildMockAssistantReply(text, agent) {
  const clean = String(text || '').trim();
  const subject = clean || 'the requested task';
  const name = agent?.name || 'this agent';
  return {
    text: `Mock execution for ${name}: I accepted "${subject}" and started a realistic dry-run. I am checking files, validating assumptions, and will report the result in the same console thread.`,
    eventType: 'chat, read_file, execute_shell_command',
  };
}

/**
 * Generate a richer set of journey events for a single agent.
 * Returns 8–12 events with multi-turn conversations that mirror trace turns.
 */
export function generateJourneyEvents(agent) {
  const seed = String(agent?.id || 'agent').length;
  const profile = WORKSTREAMS[seed % WORKSTREAMS.length];
  const count = 8 + (seed % 5);

  return Array.from({ length: count }, (_, index) => ({
    event_id: `journey-${agent?.id || 'agent'}-${index}`,
    agent_id: agent?.id || 'agent',
    agent_name: agent?.name || 'Agent-Mock',
    event_type: buildEventType(profile, index),
    status: index % 5 === 4 ? 'error' : index % 4 === 3 ? 'warning' : 'completed',
    start_time: isoFromNow(420 + (count - index) * 16),
    duration: 40 + index * 19,
    conversations: buildJourneyConversations(profile, seed, index),
  }));
}

function normalizeTownStatus(status) {
  if (status === 'waiting') return 'pending';
  if (status === 'running' || status === 'idle') return 'working';
  return status || 'offline';
}

/**
 * Event rows use the same `status` strings as GET /api/events (Event.status).
 * Do not apply agent-roster mapping (e.g. running → working) — that would break
 * Monitor / Task Ledger parity for the five dashboard buckets.
 */
function normalizeDashboardEventStatus(status) {
  if (status == null || status === '') return 'running';
  const s = String(status).toLowerCase();
  if (s === 'ok') return 'completed';
  if (s === 'fail') return 'failed';
  return String(status);
}

export function normalizeTownData(data) {
  const agents = Array.isArray(data?.agents)
    ? data.agents.map((agent) => ({ ...agent, status: normalizeTownStatus(agent.status) }))
    : [];
  const events = Array.isArray(data?.events)
    ? data.events.map((event) => ({
      ...event,
      status: normalizeDashboardEventStatus(event.status),
    }))
    : [];
  return { agents, events };
}

export async function fetchData() {
  if (USE_AGENT_TOWN_MOCK) {
    return normalizeTownData(generateMockData());
  }
  try {
    const res = await fetch('/api/trace/', { cache: 'no-store' });
    if (!res.ok) throw new Error('API error');
    const json = await res.json();
    return normalizeTownData(json);
  } catch (_) {
    return { agents: [], events: [] };
  }
}
