# Configuration Reference

All configuration is done through environment variables. No config files are required for a basic deployment.

## Server (`server.js`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | TCP port the hub server listens on. |
| `AUTH_TOKEN` | _(unset)_ | Shared secret for token authentication. When set, all REST requests must supply it as `x-auth-token` header or `Authorization: Bearer <token>`, and Socket.IO connections must pass it as `auth.token` in the handshake. When unset, auth is skipped entirely (development mode). |
| `DB_PATH` | `./data/hub.db` | Absolute or relative path for the SQLite database file. The directory must exist. |
| `SHARED_DIR` | `./shared` | Directory agents can read and write via the `file_read`, `file_write`, and `file_list` MCP tools. Relative paths are resolved from the process working directory. |
| `ROLES_CONFIG` | _(unset)_ | Absolute path to a JSON file that overrides the default agent roster. See [Roles configuration](#roles-configuration) below. |

## Client / MCP agent (`mcp-server.js`)

| Variable | Default | Description |
|---|---|---|
| `CHAT_SERVER_URL` | `http://localhost:3000` | Base URL of the hub server. |
| `AUTH_TOKEN` | _(unset)_ | Must match the server's `AUTH_TOKEN` when auth is enabled. |
| `AGENT_NAME` | _(required)_ | Display name for this agent in rooms and task assignments. |
| `SHARED_DIR` | `./shared` | Must match the server's `SHARED_DIR` (or be a path the agent can read/write that maps to the same storage). |
| `SYMPHONY_TRANSPORT` | `hub` | Selects the transport backend. `hub` uses `SocketIoHubTransport` (default). `matrix` selects `MatrixTransport` (stub — see [docs/transports.md](transports.md)). |

---

## Roles configuration

`ROLES_CONFIG` points at a JSON file with up to three top-level keys. Any key you omit falls back to the built-in generic default for that key.

```json
{
  "roles": {
    "MY_LEAD": {
      "name": "Lead Engineer",
      "category": "Engineering",
      "description": "Owns technical decisions and architecture for the project.",
      "prompt": "You are the Lead Engineer. Review designs, approve PRs, and unblock teammates.",
      "capabilities": ["architecture", "code_review", "mentoring"],
      "defaultTasks": ["Review PRs", "Design system components"],
      "priority": "high"
    }
  },
  "taskTemplates": {
    "DESIGN_REVIEW": {
      "title": "Design Review: {component_name}",
      "description": "Review the design for {component_name} against requirements.",
      "priority": "medium",
      "assignedRole": "MY_LEAD",
      "estimatedHours": 1,
      "checklist": ["Check requirements coverage", "Verify scalability", "Approve or request changes"]
    }
  },
  "quickAssignments": {
    "URGENT_REVIEW": {
      "title": "Urgent Design Review",
      "description": "A design decision needs immediate review.",
      "priority": "critical",
      "suggestedRoles": ["MY_LEAD"],
      "template": "DESIGN_REVIEW"
    }
  }
}
```

### Field reference

**Role fields** (`roles.<KEY>`)

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Human-readable display name. |
| `category` | string | yes | Logical group (used by `getCategories()` and `getRolesByCategory()`). |
| `description` | string | yes | One-line summary of the role. |
| `prompt` | string | yes | System prompt injected when an agent boots into this role. |
| `capabilities` | string[] | yes | Machine-readable capability tags. |
| `defaultTasks` | string[] | yes | Suggested tasks shown in the UI. |
| `priority` | `"low"` \| `"medium"` \| `"high"` \| `"critical"` | yes | Default priority for tasks assigned to this role. |

**Task template fields** (`taskTemplates.<KEY>`)

| Field | Type | Description |
|---|---|---|
| `title` | string | Template title; `{variable}` placeholders filled by `formatTaskFromTemplate()`. |
| `description` | string | Template body; same `{variable}` substitution. |
| `priority` | string | Default priority. |
| `assignedRole` | string \| null | Role key to pre-assign, or `null` for unassigned. |
| `estimatedHours` | number | Estimated effort. |
| `checklist` | string[] | Step-by-step checklist items. |

**Quick assignment fields** (`quickAssignments.<KEY>`)

| Field | Type | Description |
|---|---|---|
| `title` | string | Display title (may include emoji). |
| `description` | string | Short description of the scenario. |
| `priority` | string | Urgency level. |
| `suggestedRoles` | string[] | Role keys to suggest for assignment. |
| `template` | string | Task template key to use as the starting point. |
