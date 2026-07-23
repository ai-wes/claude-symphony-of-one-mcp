/**
 * End-to-end MCP client tests.
 *
 * Everything else in this suite exercises the REST API directly, which means
 * the MCP layer — the surface agents actually call — was never executed by a
 * test. This drives mcp-server.js over a real stdio MCP session against a real
 * hub, so tool-handler regressions surface here rather than in a live room.
 *
 * Covers in particular the reporting contract that agents rely on:
 *   - get_messages must not present a truncated page as the whole window
 *   - get_messages must emit a round-trippable `since` cursor
 *   - get_notifications must report the true unread total, not the page size
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./helpers.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const MCP_SERVER_JS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../mcp-server.js"
);

const textOf = (res) =>
  (res.content || []).map((c) => c.text || "").join("\n");

describe("MCP end-to-end", () => {
  let srv;
  let client;
  let transport;
  const room = `mcp-room-${randomUUID().slice(0, 8)}`;
  const sharedDir = path.join(os.tmpdir(), `mcp-shared-${randomUUID()}`);

  before(async () => {
    srv = await startServer();

    transport = new StdioClientTransport({
      command: process.execPath,
      args: [MCP_SERVER_JS],
      env: {
        ...process.env,
        CHAT_SERVER_URL: `http://localhost:${srv.port}`,
        AGENT_NAME: "mcp-test-agent",
        AUTH_TOKEN: "",
        SYMPHONY_USE_MESSAGE_CACHE: "false",
        SHARED_DIR: sharedDir,
      },
    });

    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(transport);
  });

  after(async () => {
    try { await client.close(); } catch {}
    await srv.stop();
  });

  it("handshakes and lists all 17 tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.equal(tools.length, 17, `expected 17 tools, got ${tools.length}`);
    for (const expected of [
      "room_join",
      "send_message",
      "get_messages",
      "get_notifications",
      "mark_notification_read",
      "update_task",
      "list_rooms",
      "list_agents",
      "get_room_stats",
    ]) {
      assert.ok(names.includes(expected), `missing tool: ${expected}`);
    }
  });

  it("get_messages describes the since/cursor workflow in its listing", async () => {
    // Agents pick tools from the listing; a one-line description hid `since`
    // entirely, so nobody knew incremental polling existed.
    const { tools } = await client.listTools();
    const gm = tools.find((t) => t.name === "get_messages");
    assert.match(gm.description, /since/i, "listing must mention `since`");
    assert.match(gm.description, /cursor/i, "listing must mention the cursor");
    assert.match(
      gm.description,
      /limit:0|limit: 0/i,
      "listing should mention the count-only form"
    );
  });

  it("room_join and send_message round-trip", async () => {
    const join = await client.callTool({
      name: "room_join",
      arguments: { roomName: room },
    });
    assert.ok(!join.isError, `room_join errored: ${textOf(join)}`);

    const send = await client.callTool({
      name: "send_message",
      arguments: { content: "hello from mcp" },
    });
    assert.ok(!send.isError, `send_message errored: ${textOf(send)}`);

    const get = await client.callTool({ name: "get_messages", arguments: {} });
    assert.ok(!get.isError, `get_messages errored: ${textOf(get)}`);
    assert.match(textOf(get), /hello from mcp/);
  });

  it("get_messages emits a round-trippable ISO cursor", async () => {
    const res = await client.callTool({ name: "get_messages", arguments: {} });
    const text = textOf(res);

    const m = text.match(/Next poll: since=(\S+)/);
    assert.ok(m, `expected a cursor line, got:\n${text}`);

    const cursor = m[1];
    assert.ok(
      !Number.isNaN(new Date(cursor).getTime()),
      `cursor must be parseable, got ${cursor}`
    );
    assert.match(cursor, /Z$/, "cursor must be absolute UTC");

    // Feeding the cursor straight back must be accepted (this is exactly what
    // the original bug punished: the rendered time was not valid input).
    const next = await client.callTool({
      name: "get_messages",
      arguments: { since: cursor },
    });
    assert.ok(!next.isError, `cursor round-trip errored: ${textOf(next)}`);
    assert.ok(
      !/hello from mcp/.test(textOf(next)),
      "messages at or before the cursor should not be returned again"
    );
  });

  it("get_messages surfaces the server's error for an invalid `since`", async () => {
    const res = await client.callTool({
      name: "get_messages",
      arguments: { since: "4:10 PM" },
    });
    const text = textOf(res);
    assert.ok(res.isError, "an unparseable `since` must be reported as an error");
    assert.match(
      text,
      /Invalid 'since'/,
      `the server's explanation must reach the agent, got: ${text}`
    );
    assert.ok(
      !/status code/.test(text),
      "should not leak a bare axios status message"
    );
  });

  it("get_messages flags truncation instead of implying completeness", async () => {
    // Post enough to overflow a small limit.
    for (let i = 0; i < 12; i++) {
      await client.callTool({
        name: "send_message",
        arguments: { content: `bulk-${i}` },
      });
    }

    const all = await client.callTool({ name: "get_messages", arguments: {} });
    const cursor = textOf(all).match(/Next poll: since=(\S+)/)[1];

    // Everything is now before `cursor`; post a fresh backlog after it.
    for (let i = 0; i < 12; i++) {
      await client.callTool({
        name: "send_message",
        arguments: { content: `after-${i}` },
      });
    }

    const res = await client.callTool({
      name: "get_messages",
      arguments: { since: cursor, limit: 5 },
    });
    const text = textOf(res);

    assert.match(
      text,
      /Retrieved 5 of 12 matching messages/,
      `truncation must report the true window size, got: ${text}`
    );
    assert.match(text, /TRUNCATED/, "truncation must be called out explicitly");
    assert.match(
      text,
      /after-0/,
      "paging must start at the oldest unseen message"
    );
  });

  it("get_notifications reports the true unread total", async () => {
    // A second agent mentions this one more times than a page holds.
    const otherId = randomUUID();
    await fetch(`http://localhost:${srv.port}/api/join/${room}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: otherId,
        agentName: "mentioner",
        capabilities: {},
      }),
    });
    const N = 55;
    for (let i = 0; i < N; i++) {
      await fetch(`http://localhost:${srv.port}/api/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: otherId,
          content: `@mcp-test-agent ping-${i}`,
        }),
      });
    }

    const res = await client.callTool({
      name: "get_notifications",
      arguments: { unreadOnly: true },
    });
    const text = textOf(res);
    assert.ok(!res.isError, `get_notifications errored: ${text}`);
    assert.match(
      text,
      new RegExp(`${N} unread total`),
      `unread total must be the true count (${N}), not the page size; got: ${text}`
    );
    assert.match(text, /TRUNCATED/, "truncation must be flagged");
  });

  it("task tools round-trip over MCP", async () => {
    const create = await client.callTool({
      name: "create_task",
      arguments: {
        title: "MCP task",
        description: "created over the MCP layer",
        priority: "high",
      },
    });
    assert.ok(!create.isError, `create_task errored: ${textOf(create)}`);

    const list = await client.callTool({ name: "get_tasks", arguments: {} });
    assert.ok(!list.isError, `get_tasks errored: ${textOf(list)}`);
    assert.match(textOf(list), /MCP task/, "created task must be listed");
  });

  it("memory tools round-trip over MCP", async () => {
    const key = `k-${randomUUID().slice(0, 8)}`;
    const store = await client.callTool({
      name: "memory_store",
      arguments: { key, value: "remembered-value", type: "note" },
    });
    assert.ok(!store.isError, `memory_store errored: ${textOf(store)}`);

    const recall = await client.callTool({
      name: "memory_retrieve",
      arguments: { key },
    });
    assert.ok(!recall.isError, `memory_retrieve errored: ${textOf(recall)}`);
    assert.match(textOf(recall), /remembered-value/);
  });

  it("file tools round-trip over MCP", async () => {
    const filename = `f-${randomUUID().slice(0, 8)}.txt`;
    const write = await client.callTool({
      name: "file_write",
      arguments: { filename, content: "shared file contents" },
    });
    assert.ok(!write.isError, `file_write errored: ${textOf(write)}`);

    const list = await client.callTool({ name: "file_list", arguments: {} });
    assert.ok(!list.isError, `file_list errored: ${textOf(list)}`);
    assert.match(textOf(list), new RegExp(filename));

    const read = await client.callTool({
      name: "file_read",
      arguments: { filename },
    });
    assert.ok(!read.isError, `file_read errored: ${textOf(read)}`);
    assert.match(textOf(read), /shared file contents/);
  });

  it("file tools refuse path traversal outside the shared dir", async () => {
    const res = await client.callTool({
      name: "file_read",
      arguments: { filename: "../../../etc/passwd" },
    });
    assert.ok(
      res.isError || !/root:/.test(textOf(res)),
      `path traversal must not read outside SHARED_DIR; got: ${textOf(res).slice(0, 200)}`
    );
  });

  it("send_message reports deduplicated mentions", async () => {
    const res = await client.callTool({
      name: "send_message",
      arguments: { content: "@dupe-agent once and @dupe-agent twice" },
    });
    const text = textOf(res);
    assert.ok(!res.isError, `send_message errored: ${text}`);
    // The tool echoes the mentions it parsed; one agent mentioned twice in a
    // single message is still one mention.
    const occurrences = (text.match(/dupe-agent/g) || []).length;
    assert.equal(
      occurrences,
      1,
      `mentions should be deduplicated in the MCP response, got ${occurrences} in: ${text}`
    );
  });

  it("send_message resolves dotted agent names in full", async () => {
    const res = await client.callTool({
      name: "send_message",
      arguments: { content: "@dotted.agent.name please review" },
    });
    const text = textOf(res);
    assert.ok(!res.isError, `send_message errored: ${text}`);
    assert.match(
      text,
      /dotted\.agent\.name/,
      `a dotted name must not be truncated at the first dot; got: ${text}`
    );
  });

  it("get_notifications labels mentions from other rooms", async () => {
    // Mention this agent from a DIFFERENT room than the one it is in.
    const otherRoom = `other-${randomUUID().slice(0, 6)}`;
    const outsiderId = randomUUID();
    await fetch(`http://localhost:${srv.port}/api/join/${otherRoom}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: outsiderId,
        agentName: "outsider",
        capabilities: {},
      }),
    });
    await fetch(`http://localhost:${srv.port}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: outsiderId,
        content: "@mcp-test-agent ping from elsewhere",
      }),
    });

    const res = await client.callTool({
      name: "get_notifications",
      arguments: {},
    });
    const text = textOf(res);
    assert.ok(!res.isError, `get_notifications errored: ${text}`);
    assert.match(
      text,
      new RegExp(`\\{room: ${otherRoom}\\}`),
      `a mention from another room must be labelled with its room; got: ${text}`
    );
  });

  it("get_notifications can narrow to the current room", async () => {
    const scoped = await client.callTool({
      name: "get_notifications",
      arguments: { currentRoomOnly: true },
    });
    const text = textOf(scoped);
    assert.ok(!scoped.isError, `get_notifications errored: ${text}`);
    // Nothing from another room should survive the filter, so no {room: ...}
    // label (which is only emitted for notifications outside currentRoom).
    assert.ok(
      !/\{room: /.test(text),
      `currentRoomOnly must exclude other rooms; got: ${text}`
    );
  });

  it("delivers messages from another agent in real time over the socket", async () => {
    // The socket path (onMessage) is how an MCP client learns about traffic
    // between polls; everything else here goes over REST.
    const marker = `realtime-${randomUUID().slice(0, 6)}`;
    const otherId = randomUUID();
    await fetch(`http://localhost:${srv.port}/api/join/${room}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: otherId,
        agentName: "realtime-peer",
        capabilities: {},
      }),
    });
    await fetch(`http://localhost:${srv.port}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: otherId, content: marker }),
    });

    // Give the socket event time to arrive at the MCP server process.
    await new Promise((r) => setTimeout(r, 500));

    const res = await client.callTool({ name: "get_messages", arguments: {} });
    assert.match(
      textOf(res),
      new RegExp(marker),
      "a message from another agent must be visible to this MCP client"
    );
  });

  it("counts new messages without transferring them (limit: 0)", async () => {
    const all = await client.callTool({ name: "get_messages", arguments: {} });
    const cursor = textOf(all).match(/Next poll: since=(\S+)/)[1];

    for (let i = 0; i < 4; i++) {
      await client.callTool({
        name: "send_message",
        arguments: { content: `countable-${i}` },
      });
    }

    const res = await client.callTool({
      name: "get_messages",
      arguments: { since: cursor, limit: 0 },
    });
    const text = textOf(res);
    assert.match(
      text,
      /4 new message\(s\) — count only, none fetched/,
      `limit:0 should report a count and send nothing; got: ${text}`
    );
    assert.ok(
      !/countable-0/.test(text),
      "limit:0 must not transfer message bodies"
    );
  });

  it("count-only reports new messages per agent, including you", async () => {
    const all = await client.callTool({ name: "get_messages", arguments: {} });
    const cursor = textOf(all).match(/Next poll: since=(\S+)/)[1];

    // Two from this agent, three from a peer.
    for (let i = 0; i < 2; i++) {
      await client.callTool({
        name: "send_message",
        arguments: { content: `mine-${i}` },
      });
    }
    const peerId = randomUUID();
    await fetch(`http://localhost:${srv.port}/api/join/${room}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: peerId, agentName: "chatty-peer", capabilities: {} }),
    });
    for (let i = 0; i < 3; i++) {
      await fetch(`http://localhost:${srv.port}/api/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: peerId, content: `theirs-${i}` }),
      });
    }

    const res = await client.callTool({
      name: "get_messages",
      arguments: { since: cursor, limit: 0 },
    });
    const text = textOf(res);

    assert.match(text, /By agent:/, `expected a per-agent breakdown; got: ${text}`);
    assert.match(
      text,
      /mcp-test-agent \(you\): 2/,
      `own count should be labelled and correct; got: ${text}`
    );
    assert.match(
      text,
      /chatty-peer: 3/,
      `peer count should be reported; got: ${text}`
    );
    assert.ok(!/mine-0|theirs-0/.test(text), "must not transfer bodies");
  });

  it("limit: 0 without `since` does not return the whole room", async () => {
    // slice(-0) is slice(0) — the entire array — so a zero limit used to
    // return everything instead of nothing.
    const res = await client.callTool({
      name: "get_messages",
      arguments: { limit: 0 },
    });
    assert.ok(
      !/countable-0/.test(textOf(res)),
      `limit:0 must not dump the room; got: ${textOf(res).slice(0, 200)}`
    );
  });

  it("update_task moves a task to done", async () => {
    await client.callTool({
      name: "create_task",
      arguments: { title: "closeable", description: "will be completed" },
    });
    const list = await client.callTool({ name: "get_tasks", arguments: {} });
    const id = textOf(list).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/)?.[1];
    assert.ok(id, `could not find a task id in: ${textOf(list)}`);

    const res = await client.callTool({
      name: "update_task",
      arguments: { taskId: id, status: "done" },
    });
    assert.ok(!res.isError, `update_task errored: ${textOf(res)}`);
    assert.match(textOf(res), /done/, "task should report its new status");
  });

  it("mark_notification_read clears an unread mention", async () => {
    const outsiderId = randomUUID();
    await fetch(`http://localhost:${srv.port}/api/join/${room}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: outsiderId, agentName: "reader-peer", capabilities: {} }),
    });
    await fetch(`http://localhost:${srv.port}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: outsiderId, content: "@mcp-test-agent clear me" }),
    });

    const before = await (
      await fetch(
        `http://localhost:${srv.port}/api/notifications/x?agentName=mcp-test-agent&unreadOnly=true`
      )
    ).json();
    assert.ok(before.unread > 0, "should have unread notifications to clear");

    const res = await client.callTool({
      name: "mark_notification_read",
      arguments: { notificationId: before.notifications[0].id },
    });
    assert.ok(!res.isError, `mark_notification_read errored: ${textOf(res)}`);

    const after = await (
      await fetch(
        `http://localhost:${srv.port}/api/notifications/x?agentName=mcp-test-agent&unreadOnly=true`
      )
    ).json();
    assert.equal(
      after.unread,
      before.unread - 1,
      "unread total must drop by exactly one"
    );
  });

  it("list_rooms and list_agents expose who is where", async () => {
    const rooms = await client.callTool({ name: "list_rooms", arguments: {} });
    assert.ok(!rooms.isError, `list_rooms errored: ${textOf(rooms)}`);
    assert.match(textOf(rooms), new RegExp(room), "current room should be listed");

    const agents = await client.callTool({ name: "list_agents", arguments: {} });
    assert.ok(!agents.isError, `list_agents errored: ${textOf(agents)}`);
    assert.match(
      textOf(agents),
      /mcp-test-agent/,
      "the calling agent should appear in its own room"
    );
  });

  it("get_room_stats counts messages without fetching them", async () => {
    const res = await client.callTool({ name: "get_room_stats", arguments: {} });
    const text = textOf(res);
    assert.ok(!res.isError, `get_room_stats errored: ${text}`);
    assert.match(text, new RegExp(`${room}.*\\d+ messages`), `got: ${text}`);
    assert.ok(!/countable-0/.test(text), "stats must not include message bodies");
  });

  it("tools report a clean error when not in a room", async () => {
    await client.callTool({ name: "room_leave", arguments: {} });
    const res = await client.callTool({ name: "get_messages", arguments: {} });
    assert.ok(res.isError, "get_messages outside a room must be an error");
    assert.match(textOf(res), /room_join/);
  });
});
