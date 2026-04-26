/**
 * XSafeClaw Guard Plugin for OpenClaw.
 *
 * 1. `before_tool_call` — sends every tool call to XSafeClaw for safety
 *    evaluation; unsafe calls are held until human approval.
 * 2. `before_prompt_build` — injects SAFETY.md and PERMISSION.md from the
 *    workspace into every conversation's system prompt.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/safeclaw-guard";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const TIMEOUT_MS = 310_000;

const SAFETY_FILES = ["SAFETY.md", "PERMISSION.md"] as const;
const GUARD_UNAVAILABLE_REASON = "XSafeClaw guard is unavailable, so this tool call was blocked to preserve path protection.";

function resolveWorkspaceDir(ctxWorkspaceDir?: string): string | null {
  if (ctxWorkspaceDir) return ctxWorkspaceDir;
  const configPath = join(homedir(), ".openclaw", "openclaw.json");
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (config.workspace) return config.workspace;
    } catch { /* ignore */ }
  }
  const fallback = join(homedir(), ".openclaw", "workspace");
  return existsSync(fallback) ? fallback : null;
}

const fileCache = new Map<string, { content: string; mtimeMs: number }>();

function readCachedFile(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    const { mtimeMs } = statSync(filePath);
    const cached = fileCache.get(filePath);
    if (cached && cached.mtimeMs === mtimeMs) return cached.content;
    const content = readFileSync(filePath, "utf-8").trim();
    if (!content) return null;
    fileCache.set(filePath, { content, mtimeMs });
    return content;
  } catch {
    return null;
  }
}

export default function register(api: OpenClawPluginApi) {
  const cfg = (api.pluginConfig ?? {}) as {
    safeclawUrl?: string;
    failOpenOnGuardError?: boolean;
  };
  const failOpenOnGuardError = cfg.failOpenOnGuardError === true;
  const baseUrl = (
    cfg.safeclawUrl ??
    process.env.SAFECLAW_URL ??
    "http://localhost:6874"
  ).replace(/\/$/, "");
  const toolCheckUrl = `${baseUrl}/api/guard/tool-check`;

  // ── Hook: inject SAFETY.md & PERMISSION.md into system prompt ──────
  api.on("before_prompt_build", (_event, ctx) => {
    const wsDir = resolveWorkspaceDir(ctx.workspaceDir);
    if (!wsDir) return;

    const sections: string[] = [];
    for (const filename of SAFETY_FILES) {
      const content = readCachedFile(join(wsDir, filename));
      if (content) {
        sections.push(`## ${filename}\n${content}`);
      }
    }
    if (sections.length === 0) return;

    return {
      prependSystemContext: sections.join("\n\n"),
    };
  });

  // ── Hook: tool-call guard ──────────────────────────────────────────
  api.on("before_tool_call", async (event, ctx) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const resp = await fetch(toolCheckUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // §55: explicit platform/instance_id so the backend can route
        // PendingApproval correctly when multiple runtimes share the
        // /tool-check endpoint (Hermes also calls this same URL now).
        // The values match the backend defaults, so older XSafeClaw
        // builds that don't read these fields still see identical
        // behaviour.
        body: JSON.stringify({
          tool_name: event.toolName,
          params: event.params,
          session_key: ctx.sessionKey || "",
          platform: "openclaw",
          instance_id: "openclaw-default",
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!resp.ok) {
        api.logger.warn?.(
          `safeclaw-guard: tool-check returned ${resp.status}`,
        );
        if (failOpenOnGuardError) return;
        return {
          block: true,
          blockReason: `${GUARD_UNAVAILABLE_REASON} (HTTP ${resp.status})`,
        };
      }

      const result = (await resp.json()) as {
        action: string;
        reason?: string;
      };

      if (result.action === "block") {
        return {
          block: true,
          blockReason: result.reason || "This tool call poses a security risk. You MUST inform the user about the risk and reconsider before proceeding.",
        };
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        return {
          block: true,
          blockReason: "XSafeClaw guard approval timed out",
        };
      }
      api.logger.warn?.(
        `safeclaw-guard: hook error: ${err?.message || err}`,
      );
      if (failOpenOnGuardError) return;
      return {
        block: true,
        blockReason: GUARD_UNAVAILABLE_REASON,
      };
    }
  });
}
