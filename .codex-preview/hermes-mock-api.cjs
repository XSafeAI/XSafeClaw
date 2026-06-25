const http = require("http");

const port = Number(process.env.PORT || 43174);

function json(res, obj) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === "/api/system/install-status") {
    json(res, {
      openclaw_installed: false,
      hermes_installed: true,
      nanobot_installed: false,
      codex_installed: false,
      openclaw_version: null,
      openclaw_path: null,
      nanobot_version: null,
      nanobot_path: null,
      nanobot_config_exists: false,
      nanobot_model_configured: false,
      hermes_config_exists: true,
      hermes_model_configured: false,
      hermes_api_key_configured: false,
      requires_setup: false,
      requires_configure: false,
      requires_hermes_configure: true,
      requires_nanobot_setup: false,
      requires_nanobot_configure: false,
      node_version: "mock",
    });
    return;
  }

  if (url.pathname === "/api/system/agent-store/catalog") {
    json(res, {
      agents: [
        { id: "openclaw", version: null, sizeLabel: null, status: "unknown" },
        { id: "hermes", version: "mock-preview", sizeLabel: null, status: "ready" },
        { id: "nanobot", version: null, sizeLabel: null, status: "unknown" },
        { id: "codex", version: null, sizeLabel: null, status: "unknown" },
      ],
      generatedAt: new Date().toISOString(),
      stale: false,
    });
    return;
  }

  if (url.pathname === "/api/system/status") {
    json(res, {
      platform: "windows",
      openclaw_installed: false,
      hermes_installed: true,
      hermes_path: "C:/Users/demo/AppData/Local/Programs/Hermes/hermes.exe",
      hermes_config_path: "C:/Users/demo/.hermes/config.yaml",
      hermes_home: "C:/Users/demo/.hermes",
      hermes_api_key_configured: false,
      hermes_api_server_enabled: false,
      hermes_api_port: 8642,
      api_reachable: false,
      nanobot_installed: false,
      nanobot_version: null,
      nanobot_path: null,
      nanobot_config_exists: false,
      nanobot_model_configured: false,
      daemon_running: false,
      openclaw_path: null,
      node_version: "mock",
      config_exists: false,
      has_instances: false,
      requires_setup: false,
      requires_configure: false,
      requires_nanobot_setup: false,
      requires_nanobot_configure: false,
      default_instance: null,
      instances: [],
      runtime_summary: {
        total: 0,
        enabled: 0,
        openclaw: 0,
        nanobot: 0,
        hermes: 0,
        chat_ready: 0,
      },
    });
    return;
  }

  if (url.pathname === "/api/system/onboard-scan") {
    json(res, {
      default_model: "openai/gpt-5.1",
      model_providers: [
        {
          id: "openai",
          name: "OpenAI",
          available: true,
          models: [
            { id: "openai/gpt-5.1", name: "GPT-5.1", available: true },
            { id: "openai/gpt-4.1", name: "GPT-4.1", available: true },
          ],
        },
        {
          id: "anthropic",
          name: "Anthropic",
          available: true,
          models: [
            { id: "anthropic/claude-3-5-sonnet-latest", name: "Claude 3.5 Sonnet", available: true },
          ],
        },
      ],
      provider_endpoints: {
        openai: {
          env_key: "OPENAI_BASE_URL",
          current: "",
          presets: [{ id: "default", label: "OpenAI", base_url: "https://api.openai.com/v1" }],
        },
        anthropic: {
          env_key: "ANTHROPIC_BASE_URL",
          current: "",
          presets: [{ id: "default", label: "Anthropic", base_url: "https://api.anthropic.com" }],
        },
      },
      provider_recommended_base_urls: {
        openai: "https://api.openai.com/v1",
        anthropic: "https://api.anthropic.com",
      },
    });
    return;
  }

  if (url.pathname === "/api/system/hermes-bot-platforms") {
    json(res, {
      env_path: "C:/Users/demo/.hermes/.env",
      any_configured: false,
      platforms: [
        {
          id: "telegram",
          name: "Telegram",
          hint: "Telegram Bot Token",
          docUrl: "https://core.telegram.org/bots",
          configured: false,
          fields: [
            {
              key: "bot_token",
              label: "Bot Token",
              required: true,
              secret: true,
              placeholder: "123456:ABC...",
              configured: false,
            },
          ],
        },
        {
          id: "discord",
          name: "Discord",
          hint: "Discord Bot Token",
          docUrl: "https://discord.com/developers/docs",
          configured: false,
          fields: [
            {
              key: "bot_token",
              label: "Bot Token",
              required: true,
              secret: true,
              placeholder: "discord token",
              configured: false,
            },
            {
              key: "application_id",
              label: "Application ID",
              required: false,
              secret: false,
              placeholder: "application id",
              configured: false,
            },
          ],
        },
      ],
    });
    return;
  }

  if (req.method === "POST") {
    json(res, {
      success: true,
      configured: true,
      hermes_api_server_enabled: true,
      api_reachable: true,
      hermes_api_port: 8642,
      platform: "telegram",
      written_keys: [],
      applied: true,
    });
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ detail: `mock not found ${url.pathname}` }));
});

server.listen(port, "127.0.0.1");
