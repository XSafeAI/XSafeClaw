# XSafeClaw Store-Native Agent Configuration Page Design

## Objective

Build a new Store-native configuration experience for OpenClaw, Hermes, and Nanobot. The new UI must match the current light desktop Store style and must not reuse the old dark full-screen configuration page frontend.

Existing backend configuration APIs and existing field coverage should be reused wherever possible. In this design, "reuse" means backend/API reuse, not frontend reuse.

Codex is excluded from this configuration page work.

## Scope

The Store page remains the entry point. When a user clicks the configure action on OpenClaw, Hermes, or Nanobot, the right-side main area switches from the Agent card grid to that Agent's configuration detail page. The left app sidebar remains visible.

The configuration page offers two visible modes:

- Quick configuration
- Full configuration

The default mode is Quick configuration. Users can switch to Full configuration at any time. The production UI labels should be Chinese, matching the current Store page language.

## Reused Backend Capabilities

OpenClaw uses the existing OpenClaw configuration backend:

- Load metadata and defaults with `systemAPI.onboardScan('openclaw')`.
- Save configuration with `systemAPI.onboardConfig({ platform: 'openclaw', ... })`.
- Check provider key state with `systemAPI.providerHasKey(provider, 'openclaw')`.

Hermes uses the existing Hermes configuration backend:

- Load runtime status with `systemAPI.status('hermes')`.
- Load provider/model metadata with `systemAPI.onboardScan('hermes')`.
- Save model configuration with `systemAPI.quickModelConfig({ platform: 'hermes', ... })`.
- Save, generate, reveal, and inspect API server keys with the existing Hermes API-key endpoints.
- Enable/restart Hermes API server with `systemAPI.hermesEnableApiServer()` and `systemAPI.hermesApply()`.
- Load and save Bot platform credentials with `systemAPI.hermesBotPlatforms()` and `systemAPI.hermesBotConfig()`.

Nanobot uses the existing Nanobot configuration backend:

- Load current config with `systemAPI.getNanobotConfig()`.
- Load provider/model catalog with `systemAPI.getNanobotModelCatalog()`.
- Save config and trigger backend restart behavior with `systemAPI.setNanobotConfig(payload)`.

Install and configuration state continues to come from `systemAPI.installStatus()`.

## Layout

The Store-native config detail page uses the same visual language as the Agent Store:

- Light background.
- White panels with subtle borders.
- Compact Store-style badges.
- Dense but readable operational layout.
- No old dark wizard shell.

Top area:

- Back button to Agent Store.
- Agent icon, name, installed state, and configured state.
- Mode switch: Quick configuration / Full configuration.
- Right-side action area for save/apply actions.

Body:

- Left side: step navigation for the selected mode.
- Right side: active form section.
- Bottom: previous, next, and final apply/save action.

## OpenClaw Configuration Content

OpenClaw content follows the existing `Configure.tsx` form and backend payload.

Quick configuration includes:

- Config handling: update existing config or reset.
- Model and authentication: auth provider, auth method, API key, model ID.
- Final review and apply.

Full configuration includes:

- Security acknowledgement.
- Quick/manual mode choice.
- Config handling and reset scope.
- Setup type: local or remote.
- Workspace path.
- Auth provider, auth method, API key, model ID.
- Provider-specific fields:
  - Cloudflare account and gateway IDs.
  - LiteLLM base URL.
  - vLLM base URL and model ID.
  - Custom base URL, custom model ID, custom provider ID, compatibility mode, context window.
- Gateway:
  - Port.
  - Bind address.
  - Auth mode.
  - Gateway token.
  - Tailscale exposure.
- Channels:
  - Feishu/Lark app ID and secret.
  - WebSocket or webhook mode.
  - Feishu/Lark domain.
  - Group policy and allowlist.
  - Webhook verification token and path.
- Search provider and search API key.
- Skills.
- Hooks.
- Finalize daemon option.
- Review and apply.

## Hermes Configuration Content

Hermes content follows the existing Hermes flow in `Configure.tsx`.

Quick configuration includes:

- API server key save/generate/reveal as needed.
- Model provider and model.
- Optional base URL override when required by the provider.
- Enable/apply API server.
- Final readiness check.

Full configuration includes:

- Security acknowledgement.
- Mode choice.
- Current runtime and API server status.
- API key management.
- Model provider and model configuration.
- Provider endpoint/base URL controls.
- Bot platform credentials rendered from backend schema.
- Apply/restart API server.
- Final status and review.

## Nanobot Configuration Content

Nanobot content follows the existing `NanobotConfigure.tsx` form and payload.

Quick configuration includes:

- Provider.
- Model.
- API key.
- Optional API base.
- Apply configuration using default workspace, gateway, WebSocket, and Guard values.

Full configuration includes:

- Security acknowledgement.
- Quick/manual mode choice.
- Model and secret:
  - Provider.
  - Model ID.
  - API key.
  - API base.
  - Clear stored API key.
- Workspace path.
- Gateway:
  - Host.
  - Port.
- WebSocket:
  - Enabled state.
  - Host.
  - Port.
  - Path.
  - Token requirement.
  - Token value.
- Guard:
  - Mode.
  - Base URL.
  - Timeout.
- Review and apply.

## Store Card Behavior

For OpenClaw, Hermes, and Nanobot:

- Not installed: show install action.
- Installed but not configured: show go-configure action.
- Installed and configured: show configure action.

For Codex:

- Keep install/status behavior.
- Do not show a configuration entry in this feature.

Clicking the configuration action should not route to the old configuration pages. It should set Store's active right-side view to the new Store-native configuration detail page.

## Error Handling

If metadata loading fails:

- Keep the page open.
- Show an inline error banner in the form panel.
- Keep any already loaded local form state.
- Allow retry.

If saving fails:

- Show an inline error banner with backend detail when available.
- Do not mark the Agent as configured.
- Preserve form values.

If saving succeeds:

- Refresh `installStatus`.
- Mark configured state from the refreshed backend status.
- Show a success state in the page header or review panel.

## Testing

Frontend tests should cover:

- Store configuration action opens a Store-native detail page, not the old route page.
- OpenClaw, Hermes, and Nanobot all expose Quick configuration and Full configuration.
- Codex has no configuration action.
- Quick mode renders only the quick-mode field groups for each Agent.
- Full mode renders the old configuration page field coverage in the new UI.
- Successful save calls the correct existing backend API per Agent.
- Failed save keeps form values and displays an error.
- Returning to Agent Store restores the card grid.

Build verification:

- `cd frontend && npm run test -- App.test.tsx --run`
- `cd frontend && npm run build`
