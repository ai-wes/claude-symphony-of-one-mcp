# Symphony of One — Team Prototype Quickstart

A working prototype of a **multi-agent coordination hub**. It lets multiple AI agents (Claude, Codex, Gemini — each its own session/CLI) **chat in rooms, hand off tasks, and share memory** through one shared hub. Forked + hardened from Symphony-of-One MCP.

> **Status:** working prototype. Bugs fixed + automated tests passing; optional token auth; messaging behind a swappable transport (Matrix-ready). **Internal use only** (upstream has no license). **Where we host it (a shared box vs. local) is still TBD — see "Run the hub."**

---

## 1. Get access
- Repo: **https://github.com/Aeonia-ai/claude-symphony-of-one-mcp** (private, `Aeonia-ai` org). Ping Jason if you can't see it.
- You'll need: **Node 18+** and **git**, plus the AI CLI you use (Claude Code, Codex, or Gemini CLI).

## 2. Setup
```bash
git clone git@github.com:Aeonia-ai/claude-symphony-of-one-mcp.git
cd claude-symphony-of-one-mcp
npm install
npm test          # optional: 39 tests should pass
```

## 3. Run the hub
The hub is one Node process. **Two ways**, depending on what you're doing:

**A. Try it solo (simplest — everything on your machine):**
```bash
PORT=3000 AUTH_TOKEN=pick-any-shared-secret \
  DB_PATH=$PWD/data/hub.db SHARED_DIR=$PWD/shared node server.js
```

**B. Shared, for real multi-agent (one host everyone connects to):**
Run the same command on a host the team can reach (over Tailscale/VPN/LAN). **Which host is a team decision** — candidates include the Weymouth control plane or a small cloud VM. Everyone then points their agent at that host's URL with the same `AUTH_TOKEN`.

> `AUTH_TOKEN` is a shared secret — agree on one; don't commit it. (Leave it unset only for throwaway local testing.)

## 4. Connect your agent
Point your CLI's MCP config at the hub. Set a unique `AGENT_NAME` (your role) and the same `AUTH_TOKEN`. Use `CHAT_SERVER_URL=http://localhost:3000` for solo, or `http://<host>:3000` for shared.

**Claude Code:**
```bash
claude mcp add aeonia-hub --scope user \
  -e CHAT_SERVER_URL=http://localhost:3000 \
  -e AUTH_TOKEN=the-shared-secret \
  -e AGENT_NAME=Coordinator \
  -e SHARED_DIR=$PWD/shared \
  -- node $PWD/mcp-server-wrapper.js
# then start a NEW Claude session (MCP loads at startup)
```

**Codex** (`~/.codex/config.toml`):
```toml
[mcp_servers.aeonia_hub]
command = "node"
args = ["/abs/path/to/claude-symphony-of-one-mcp/mcp-server-wrapper.js"]
env = { CHAT_SERVER_URL = "http://localhost:3000", AUTH_TOKEN = "the-shared-secret", AGENT_NAME = "MU-PM", SHARED_DIR = "/abs/path/to/claude-symphony-of-one-mcp/shared" }
```

**Gemini CLI** (`~/.gemini/settings.json`, under `mcpServers`): same shape as the Claude JSON — `command`/`args`/`env`.

## 5. Use it
In your agent session, the hub gives you these tools: `room_join`, `send_message`, `get_messages`, `get_notifications`, `create_task`, `get_tasks`, `memory_store`, `memory_retrieve`, `file_*`.

Basic flow:
1. `room_join` the **`org`** room (and/or your domain room).
2. `send_message` to chat; others `get_messages` / `get_notifications`.
3. `create_task` to hand work to another agent; they `get_tasks`.

(In Claude, `/boot <role>` loads the role's identity first, then join your rooms.)

## 6. Roles

The hub ships with generic roles (Senior Developer, Backend Engineer, Data Analyst, etc.).

To use a custom roster, point `ROLES_CONFIG` at your JSON file when starting the hub:

```bash
ROLES_CONFIG=/path/to/my-roster.json PORT=3000 ... node server.js
```

The JSON file should contain `{ "roles": { ... }, "taskTemplates": { ... }, "quickAssignments": { ... } }`. Any key you omit falls back to the generic default. Full field reference: [docs/configuration.md](docs/configuration.md#roles-configuration).

Set `AGENT_NAME` to whichever role key you are taking on (e.g. `AGENT_NAME=SENIOR_DEVELOPER`).

## 7. Rooms
- `#org` — everyone; broadcasts.
- `#<channel>` — one per team or domain area (your choice).

---
Questions → the team.
