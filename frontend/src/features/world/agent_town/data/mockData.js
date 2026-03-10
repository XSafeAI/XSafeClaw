import { CHAR_NAMES, WALK_ZONES } from '../config/constants';

const TASKS = [
  'Reviewing authentication module for security vulnerabilities...',
  'Running unit tests on payment processing pipeline...',
  'Deploying updated API endpoints to staging environment...',
  'Monitoring system health metrics and alert thresholds...',
  'Analyzing database query performance bottlenecks...',
  'Refactoring legacy error handling in middleware layer...',
  'Scanning dependency tree for known CVE vulnerabilities...',
  'Optimizing image processing pipeline throughput...',
  'Building CI/CD pipeline configuration for new microservice...',
  'Investigating memory leak in WebSocket connection pool...',
  'Generating API documentation from OpenAPI schema...',
  'Configuring load balancer rules for blue-green deployment...',
  'Running integration tests against external payment provider...',
  'Setting up distributed tracing with OpenTelemetry...',
  'Migrating database schema with zero-downtime strategy...',
  'Validating input sanitization across all REST endpoints...',
  'Benchmarking Redis cache hit rates under load...',
  'Implementing rate limiting for public API endpoints...',
  'Auditing IAM roles and permission boundaries...',
  'Profiling CPU usage in data transformation workers...',
];

const TOOL_CALLS = [
  'execute_command("npm test -- --coverage")',
  'read_file("/src/auth/middleware.js")',
  'write_file("/src/config/database.yml", config_data)',
  'search_codebase("vulnerable_pattern", regex=true)',
  'run_query("SELECT * FROM metrics WHERE ts > NOW()-1h")',
  'deploy_service("api-gateway", env="staging")',
  'create_pull_request(title="Fix auth bypass", branch="hotfix/auth")',
  'install_package("opentelemetry-sdk@1.4.0")',
  'execute_command("docker build -t api:latest .")',
  'send_notification(channel="#ops", msg="Deploy complete")',
];

const ASSISTANT_RESPONSES = [
  'I found 3 potential SQL injection vectors in the query builder. Let me patch them with parameterized queries.',
  'The test suite passes with 94% coverage. Two edge cases in payment refund flow need attention.',
  'Deployment to staging is complete. Health checks are green across all 4 replicas.',
  'CPU usage spiked to 87% during the last batch job. I\'ve identified the bottleneck in the serialization step.',
  'The Redis cache hit rate improved from 72% to 91% after adjusting the TTL strategy.',
  'I\'ve set up OpenTelemetry with Jaeger backend. Traces are now visible in the dashboard.',
  'The database migration completed successfully with zero downtime using the blue-green approach.',
  'Found 2 CVEs in the dependency tree: lodash (CVE-2021-23337) and axios (CVE-2023-45857). Updating now.',
  'Rate limiting is now active: 100 req/min for authenticated, 20 req/min for anonymous users.',
  'The memory leak was caused by unclosed WebSocket connections in the pool. Patch applied.',
  'API documentation generated from OpenAPI spec. 47 endpoints documented with examples.',
  'Load balancer configured for canary deployment: 10% traffic to new version initially.',
];

const PROVIDERS = ['anthropic', 'openai', 'google', 'anthropic', 'openai'];
const MODELS    = ['claude-sonnet-4', 'gpt-4o', 'gemini-2.0', 'claude-haiku', 'gpt-4o-mini'];
const TYPES     = [
  'code_review', 'testing', 'deployment', 'monitoring',
  'analysis', 'security_scan', 'optimization', 'documentation',
];

export function generateMockData() {
  const count = Math.min(20, WALK_ZONES.length);
  const agents = [];
  for (let i = 0; i < count; i++) {
    agents.push({
      id: 'agent-' + i,
      name: 'Agent-' + CHAR_NAMES[i % CHAR_NAMES.length],
      pid: String(10000 + i),
      provider: PROVIDERS[i % PROVIDERS.length],
      model: MODELS[i % MODELS.length],
      status: i === 4 ? 'waiting' : (i < 16 ? 'running' : (i < 18 ? 'idle' : 'offline')),
      first_seen_at: new Date(Date.now() - 3600000).toISOString(),
    });
  }

  const events = agents
    .filter(a => a.status !== 'offline')
    .map((a, i) => ({
      event_id: 'evt-' + i,
      agent_id: a.id,
      agent_name: a.name,
      event_type: TYPES[i % TYPES.length],
      status: i === 4 ? 'waiting' : 'running',
      start_time: new Date(Date.now() - 600000).toISOString(),
      end_time: new Date().toISOString(),
      duration: 120 + i * 30,
      conversations: [
        { role: 'user', text: 'Execute task ' + (i + 1) },
        { role: 'assistant', text: TASKS[i % TASKS.length] },
      ],
    }));

  return { agents, events };
}

/**
 * Generate a richer set of journey events for a single agent.
 * Returns 8–15 events with multi-turn conversations (user, assistant, tool).
 */
export function generateJourneyEvents(agent) {
  const seed = (agent.id || 'x').charCodeAt(agent.id.length - 1) || 42;
  const rng  = (i) => ((seed * 13 + i * 37) % 97) / 97;
  const count = 8 + Math.floor(rng(0) * 7);

  const events = [];
  for (let i = 0; i < count; i++) {
    const convos = [
      { role: 'user', text: TASKS[(seed + i) % TASKS.length] },
    ];

    // Add 1–3 tool calls
    const toolCount = 1 + Math.floor(rng(i * 3) * 3);
    for (let t = 0; t < toolCount; t++) {
      convos.push({
        role: 'tool',
        text: TOOL_CALLS[(seed + i + t) % TOOL_CALLS.length],
      });
    }

    // Assistant response
    convos.push({
      role: 'assistant',
      text: ASSISTANT_RESPONSES[(seed + i) % ASSISTANT_RESPONSES.length],
    });

    const hasWarning = rng(i * 7) > 0.8;

    events.push({
      event_id: `journey-${agent.id}-${i}`,
      agent_id: agent.id,
      event_type: TYPES[(seed + i) % TYPES.length],
      status: hasWarning ? 'warning' : 'completed',
      start_time: new Date(Date.now() - (count - i) * 300000).toISOString(),
      duration: 30 + Math.floor(rng(i * 5) * 300),
      conversations: convos,
    });
  }

  return events;
}

export async function fetchData() {
  try {
    const res = await fetch('/api/trace/', { cache: 'no-store' });
    if (!res.ok) throw new Error('API error');
    return await res.json();
  } catch (_) {
    return generateMockData();
  }
}
