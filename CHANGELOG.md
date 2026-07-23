# Changelog

All notable changes in this fork relative to upstream (`ai-wes/claude-symphony-of-one-mcp`).

## [Fork] 2026-06

### Bug fixes

Five coordination bugs fixed, each covered by a dedicated regression test in `test/`:

1. **Room leave** (`bug1-room-leave`) — agents were not reliably removed from the room roster on disconnect; the leave endpoint now atomically removes the agent and broadcasts a presence update.
2. **Cache invalidation** (`bug2-cache-clear`) — stale message-cache entries survived room transitions, causing agents to receive messages from rooms they had already left.
3. **Task persistence** (`bug3-task-persistence`) — tasks created via the API were held only in memory and lost on server restart; tasks are now written to SQLite and reloaded on boot.
4. **CLI routes** (`bug4-cli-routes`) — several CLI orchestrator routes (`/rooms`, `/agents`, `/tasks`) returned 404 due to missing Express registrations.
5. **Task assignment broadcast** (`bug5-task-assigned`) — the `task_assigned` Socket.IO event was emitted before the task was committed, so clients occasionally received the notification before the task was readable via GET.

### New capabilities

- **Automated test suite** — `node --test` suite in `test/`; 39 tests across bugs, auth, transport, and role config. Run with `npm test`.
- **Optional token auth** — shared-secret authentication via `AUTH_TOKEN` env var. REST endpoints check `x-auth-token` header or `Authorization: Bearer <token>`; Socket.IO checks the handshake `auth.token`. Auth is a no-op when `AUTH_TOKEN` is unset (development mode).
- **Pluggable transport adapter** — the `transport/` module defines a `Transport` base class with a 14-method contract. `createTransport()` selects the backend via `SYMPHONY_TRANSPORT`. Ships with `SocketIoHubTransport` (default) and `MatrixTransport` (stub, ready for implementation). See [docs/transports.md](docs/transports.md).
- **Config-loadable roles** (`ROLES_CONFIG`) — agent roles, task templates, and quick assignments are loaded from an external JSON file at startup. Generic Symphony defaults are used when the env var is unset. Any of the three top-level keys can be omitted to fall back to the default for that key. See [docs/configuration.md](docs/configuration.md).
- **Dynamic role categories** — `getCategories()` derives the category list from whichever role set is active (default or custom), so custom rosters can introduce new categories without code changes.
