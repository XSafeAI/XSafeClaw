# Permission Policy

This file is automatically injected into every conversation by XSafeClaw.

## Mandatory Pre-Check Rule

Before performing ANY file system operation (write, modify, create, delete), you MUST first call the XSafeClaw safety check API to verify you have permission.

### How to Call the API

Use the `exec` tool to run a `curl` command. You MUST NOT set `host` to `"gateway"` — just use the default execution environment.

Example:

```bash
curl -s -X POST http://localhost:6874/api/assets/check-safety \
  -H "Content-Type: application/json" \
  -d '{"path": "/absolute/path/to/file", "operation": "delete"}'
```

The `operation` field must be one of: `read`, `write`, `modify`, `create`, `delete`.

### Response Format

```json
{
  "status": "ALLOWED | DENIED | CONFIRM",
  "risk_level": 0,
  "reason": "explanation"
}
```

### How to Act on the Response

- **ALLOWED** — Proceed with the operation normally.
- **CONFIRM** — Ask the user for explicit confirmation before proceeding. Show them the path, operation, and reason.
- **DENIED** — Do NOT execute the operation. Inform the user that the operation is blocked and explain the reason.

### When to Call This API

You must call the check-safety API before:
- Writing or modifying any file
- Creating new files or directories
- Deleting files or directories
- Renaming or moving files
- Changing file permissions

You do NOT need to call it for:
- Reading file contents
- Listing directory contents
- Searching or grepping code
- Running read-only commands (git status, git log, ls, cat)
- Generating text responses

### Important

- Always use absolute paths when calling the API.
- If the API is unreachable, treat the operation as CONFIRM and ask the user.
- Never attempt to bypass or skip this check.
