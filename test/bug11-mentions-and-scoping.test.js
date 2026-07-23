/**
 * Bug 11: mention parsing and notification scoping
 *
 * a) parseMentions used /@(\w+(?:-\w+)*)/, which stops at the first dot —
 *    "@agent.with.dots" parsed as "agent", silently targeting a different
 *    agent (or nobody) with no error.
 * b) Mentions were not deduplicated, so "@x ... @x" in one message created two
 *    notification rows for one event. Observed in production logs as
 *    "mentions: mc-dev-coder, dev-coordinator, dev-coordinator".
 * c) Notification retrieval matched by agent id/name across ALL rooms with no
 *    way to narrow it and no indication of which room a mention came from.
 *
 * The scoping fix is deliberately opt-in: narrowing retrieval by default would
 * silently hide mentions agents already rely on, which is the same class of
 * bug as everything else in this suite.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startServer } from "./helpers.js";

describe("Bug 11 – mention parsing", () => {
  let srv, base;
  const room = "mention-room";
  const senderId = randomUUID();

  const send = (content) =>
    fetch(`${base}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: senderId, content }),
    }).then((r) => r.json());

  before(async () => {
    srv = await startServer();
    base = `http://localhost:${srv.port}`;
    await fetch(`${base}/api/join/${room}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: senderId, agentName: "sender", capabilities: {} }),
    });
  });

  after(async () => {
    await srv.stop();
  });

  it("parses dotted names in full", async () => {
    const res = await send("@agent.with.dots please look");
    assert.deepEqual(
      res.mentions,
      ["agent.with.dots"],
      "a dotted name must resolve fully, not truncate at the first dot"
    );
  });

  it("still parses hyphenated and underscored names", async () => {
    const res = await send("@client-UI-planner and @agent_under ping");
    assert.deepEqual(res.mentions, ["client-UI-planner", "agent_under"]);
  });

  it("does not swallow trailing punctuation into the name", async () => {
    const res = await send("ping @dev-coordinator. thanks");
    assert.deepEqual(
      res.mentions,
      ["dev-coordinator"],
      "a sentence-ending dot must not become part of the name"
    );
  });

  it("deduplicates repeated mentions of the same agent", async () => {
    const res = await send("@dev-coordinator and again @dev-coordinator");
    assert.deepEqual(
      res.mentions,
      ["dev-coordinator"],
      "one message mentioning an agent twice is still one mention"
    );
  });

  it("deduplicates case-insensitively, keeping the first spelling", async () => {
    const res = await send("@Dev-Coordinator then @dev-coordinator");
    assert.deepEqual(res.mentions, ["Dev-Coordinator"]);
  });

  it("a duplicated mention creates only one notification row", async () => {
    const targetId = randomUUID();
    const name = `dupe-target-${randomUUID().slice(0, 6)}`;
    await send(`@${name} once @${name} twice`);

    const body = await (
      await fetch(
        `${base}/api/notifications/${targetId}?agentName=${encodeURIComponent(name)}`
      )
    ).json();
    assert.equal(
      body.notifications.length,
      1,
      `expected exactly one notification, got ${body.notifications.length}`
    );
  });

  it("keeps distinct mentions in one message", async () => {
    const res = await send("@alpha-one and @beta.two and @gamma_three");
    assert.deepEqual(res.mentions, ["alpha-one", "beta.two", "gamma_three"]);
  });
});

describe("Bug 11 – notification room scoping", () => {
  let srv, base;
  const roomA = "scope-room-a";
  const roomB = "scope-room-b";
  const senderA = randomUUID();
  const senderB = randomUUID();
  const targetId = randomUUID();
  const target = "scoped-target";

  before(async () => {
    srv = await startServer();
    base = `http://localhost:${srv.port}`;
    for (const [id, name, room] of [
      [senderA, "sender-a", roomA],
      [senderB, "sender-b", roomB],
    ]) {
      await fetch(`${base}/api/join/${room}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: id, agentName: name, capabilities: {} }),
      });
    }
    for (const id of [senderA, senderB]) {
      await fetch(`${base}/api/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: id, content: `@${target} ping` }),
      });
    }
  });

  after(async () => {
    await srv.stop();
  });

  const notifs = (qs = "") =>
    fetch(
      `${base}/api/notifications/${targetId}?agentName=${target}${qs}`
    ).then((r) => r.json());

  it("returns mentions from every room by default (unchanged behaviour)", async () => {
    const body = await notifs();
    const rooms = new Set(body.notifications.map((n) => n.room));
    assert.equal(body.notifications.length, 2);
    assert.deepEqual([...rooms].sort(), [roomA, roomB]);
  });

  it("narrows to a single room when `room` is supplied", async () => {
    const body = await notifs(`&room=${roomA}`);
    assert.equal(body.notifications.length, 1, "should only see room A");
    assert.equal(body.notifications[0].room, roomA);
  });

  it("reports totals consistent with the room filter", async () => {
    const body = await notifs(`&room=${roomB}&unreadOnly=true`);
    assert.equal(body.notifications.length, 1);
    assert.equal(body.notifications[0].room, roomB);
  });

  it("every notification carries its source room", async () => {
    const body = await notifs();
    for (const n of body.notifications) {
      assert.ok(n.room, "notification must identify which room it came from");
    }
  });
});
