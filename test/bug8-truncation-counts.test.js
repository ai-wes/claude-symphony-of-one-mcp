/**
 * Bug 8: silent truncation misreported as a complete answer
 *
 * Two under-reports, both in the same family as the bug6 `since` filter —
 * a partial result presented as the whole truth:
 *
 *   A. GET /api/messages/:room applied `slice(-limit)` AFTER the `since`
 *      filter, so a 120-message backlog with limit=50 returned the NEWEST 50
 *      and dropped the 50 oldest unseen ones. The caller then advanced its
 *      cursor past them, so they were skipped permanently. The response
 *      carried no total, so "50 messages" was indistinguishable from
 *      "50 of 120".
 *
 *   B. GET /api/notifications/:agentId hardcoded `LIMIT 50` and reported the
 *      page as the total, so 60 unread mentions were announced as
 *      "50 unread total" — and notifications beyond 50 were unreachable.
 *
 * RED: counts equal the page size; oldest unseen messages are dropped.
 * GREEN: totals are truthful, truncation is flagged, and `since` paging walks
 *        the backlog oldest-first without gaps.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startServer } from "./helpers.js";

describe("Bug 8 – truncation counts", () => {
  let srv, base;
  const room = "count-room";
  const senderId = randomUUID();
  const targetId = randomUUID();
  const TOTAL = 120;
  let cursor;

  const send = (id, content) =>
    fetch(`${base}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: id, content }),
    });

  before(async () => {
    srv = await startServer();
    base = `http://localhost:${srv.port}`;

    for (const [id, name] of [
      [senderId, "sender-bot"],
      [targetId, "coordinator"],
    ]) {
      await fetch(`${base}/api/join/${room}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: id, agentName: name, capabilities: {} }),
      });
    }

    cursor = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    for (let i = 0; i < TOTAL; i++) await send(senderId, `new-${i}`);
  });

  after(async () => {
    await srv.stop();
  });

  it("reports the true match count when truncating a `since` window", async () => {
    const res = await fetch(
      `${base}/api/messages/${room}?since=${encodeURIComponent(cursor)}&limit=50`
    );
    const body = await res.json();
    assert.equal(body.returned, 50, "page size should honour limit");
    assert.equal(
      body.matched,
      TOTAL,
      `matched must report the full window (${TOTAL}), not the page size`
    );
    assert.equal(body.hasMore, true, "truncation must be flagged");
  });

  it("truncates a `since` window from the OLDEST end so nothing is skipped", async () => {
    const res = await fetch(
      `${base}/api/messages/${room}?since=${encodeURIComponent(cursor)}&limit=50`
    );
    const body = await res.json();
    const contents = body.messages.map((m) => m.content);
    assert.equal(
      contents[0],
      "new-0",
      `paging must start at the oldest unseen message, got ${contents[0]}`
    );
    assert.ok(
      !contents.includes("new-119"),
      "the newest message must not be returned while a backlog remains"
    );
  });

  it("repeated cursor polls walk the whole backlog with no gaps", async () => {
    const seen = [];
    let c = cursor;
    for (let guard = 0; guard < 10; guard++) {
      const res = await fetch(
        `${base}/api/messages/${room}?since=${encodeURIComponent(c)}&limit=50`
      );
      const body = await res.json();
      if (!body.messages.length) break;
      seen.push(...body.messages.map((m) => m.content));
      c = body.messages[body.messages.length - 1].timestamp;
      if (!body.hasMore) break;
    }
    assert.equal(
      seen.length,
      TOTAL,
      `cursor paging must surface all ${TOTAL} messages, saw ${seen.length}`
    );
    for (let i = 0; i < TOTAL; i++) {
      assert.ok(seen.includes(`new-${i}`), `new-${i} was skipped`);
    }
  });

  it("without `since`, still returns the most recent messages", async () => {
    const res = await fetch(`${base}/api/messages/${room}?limit=10`);
    const body = await res.json();
    const contents = body.messages.map((m) => m.content);
    assert.equal(
      contents[contents.length - 1],
      "new-119",
      "a plain fetch should still return the newest tail"
    );
  });

  it("reports the true unread notification total, not the page size", async () => {
    const N = 60;
    for (let i = 0; i < N; i++) await send(senderId, `@coordinator ping-${i}`);

    const res = await fetch(
      `${base}/api/notifications/${targetId}?agentName=coordinator&unreadOnly=true`
    );
    const body = await res.json();

    assert.equal(body.returned, 50, "page should stay bounded at the default 50");
    assert.equal(
      body.unread,
      N,
      `unread must be the true count (${N}), not the page size`
    );
    assert.equal(body.hasMore, true, "truncation must be flagged");
  });

  it("older notifications remain reachable via offset", async () => {
    const first = await (
      await fetch(
        `${base}/api/notifications/${targetId}?agentName=coordinator&unreadOnly=true`
      )
    ).json();
    const second = await (
      await fetch(
        `${base}/api/notifications/${targetId}?agentName=coordinator&unreadOnly=true&offset=50`
      )
    ).json();

    assert.ok(second.notifications.length > 0, "offset page must return rows");
    const firstIds = new Set(first.notifications.map((n) => n.id));
    assert.ok(
      second.notifications.every((n) => !firstIds.has(n.id)),
      "offset page must not repeat the first page"
    );
  });
});
