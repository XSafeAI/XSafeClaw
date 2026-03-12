/**
 * SafeClaw Guard Plugin for OpenClaw.
 *
 * Registers a `before_tool_call` hook that sends every tool call to the
 * SafeClaw backend for safety evaluation.  If the guard model deems the
 * call unsafe the request is held server-side until a human approves,
 * rejects, or modifies the parameters.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/safeclaw-guard";

const TIMEOUT_MS = 310_000;

export default function register(api: OpenClawPluginApi) {
  const cfg = (api.pluginConfig ?? {}) as { safeclawUrl?: string };
  const baseUrl = (
    cfg.safeclawUrl ??
    process.env.SAFECLAW_URL ??
    "http://localhost:6874"
  ).replace(/\/$/, "");
  const toolCheckUrl = `${baseUrl}/api/guard/tool-check`;

  api.on("before_tool_call", async (event, ctx) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const resp = await fetch(toolCheckUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool_name: event.toolName,
          params: event.params,
          session_key: ctx.sessionKey || "",
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!resp.ok) {
        api.logger.warn?.(
          `safeclaw-guard: tool-check returned ${resp.status}, allowing tool call`,
        );
        return;
      }

      const result = (await resp.json()) as {
        action: string;
        reason?: string;
        params?: Record<string, unknown>;
      };

      if (result.action === "block") {
        return {
          block: true,
          blockReason: result.reason || "Blocked by SafeClaw guard",
        };
      }

      if (result.action === "modify" && result.params) {
        return { params: result.params };
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        return {
          block: true,
          blockReason: "SafeClaw guard approval timed out",
        };
      }
      api.logger.warn?.(
        `safeclaw-guard: hook error: ${err?.message || err}, allowing tool call`,
      );
    }
  });
}
