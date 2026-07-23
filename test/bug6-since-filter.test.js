/**
 * Bug 6: GET /api/messages/:room `since` filter returns a false empty
 *
 * `const sinceTime = new Date(since).getTime()` yields NaN for any unparseable
 * value, and every `> NaN` comparison is false — so the filter dropped ALL
 * messages and returned 200 with `{messages: []}`. A false "nothing new" is
 * indistinguishable from a genuinely quiet room, so polling agents silently
 * skipped work.
 *
 * The trap was self-inflicted: get_messages renders timestamps with
 * toLocaleTimeString() ("4:10:32 PM"), and feeding that displayed value back
 * as `since` hit the NaN path every time.
 *
 * Related: a date-time with no timezone designator is parsed in the SERVER's
 * timezone, so an agent polling from another timezone gets the wrong window.
 *
 * RED: invalid/ambiguous `since` returns 200 with an empty message list.
 * GREEN: invalid returns 400; valid ISO-with-offset filters correctly.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startServer } from "./helpers.js";

describe("Bug 6 – since filter false empty", () => {
  let srv;
  const room = "since-filter-room";
  const agentId = randomUUID();
  let base; // URL prefix
  let firstTs; // ISO timestamp of the first message

  before(async () => {
    srv = await startServer();
    base = `http://localhost:${srv.port}`;

    await fetch(`${base}/api/join/${room}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, agentName: "SinceBot", capabilities: {} }),
    });

    await fetch(`${base}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, content: "first message" }),
    });

    const res = await fetch(`${base}/api/messages/${room}`);
    const body = await res.json();
    firstTs = body.messages[body.messages.length - 1].timestamp;

    // Ensure the second message is strictly newer than the first.
    await new Promise((r) => setTimeout(r, 25));

    await fetch(`${base}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, content: "second message" }),
    });
  });

  after(async () => {
    await srv.stop();
  });

  it("valid ISO `since` returns only newer messages", async () => {
    const res = await fetch(
      `${base}/api/messages/${room}?since=${encodeURIComponent(firstTs)}`
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    const contents = body.messages.map((m) => m.content);
    assert.ok(
      contents.includes("second message"),
      "messages after `since` must be returned"
    );
    assert.ok(
      !contents.includes("first message"),
      "messages at or before `since` must be excluded"
    );
  });

  it("a `since` in the past returns the populated window, not empty", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const res = await fetch(
      `${base}/api/messages/${room}?since=${encodeURIComponent(past)}`
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(
      body.messages.length >= 2,
      `provably populated window must not come back empty (got ${body.messages.length})`
    );
  });

  for (const bad of ["4:10 PM", "4:10:32 PM", "1 minute ago", "not-a-date"]) {
    it(`rejects unparseable since=${JSON.stringify(bad)} with 400, not a silent empty`, async () => {
      const res = await fetch(
        `${base}/api/messages/${room}?since=${encodeURIComponent(bad)}`
      );
      assert.equal(
        res.status,
        400,
        "unparseable `since` must error loudly rather than return zero messages"
      );
      const body = await res.json();
      assert.match(body.error, /Invalid 'since'/);
    });
  }

  it("rejects a timezone-less date-time as ambiguous", async () => {
    const res = await fetch(
      `${base}/api/messages/${room}?since=${encodeURIComponent("2026-07-23T16:10:00")}`
    );
    assert.equal(res.status, 400, "offset-less date-time must be rejected");
    const body = await res.json();
    assert.match(body.error, /Ambiguous 'since'/);
  });

  it("accepts an explicit non-UTC offset, so cross-timezone agents work", async () => {
    // Same instant as `past`, expressed with a +09:00 (Tokyo) offset.
    const past = new Date(Date.now() - 60_000);
    const tokyo = new Date(past.getTime() + 9 * 3600_000)
      .toISOString()
      .replace(/\.\d+Z$/, "+09:00");

    const res = await fetch(
      `${base}/api/messages/${room}?since=${encodeURIComponent(tokyo)}`
    );
    assert.equal(res.status, 200, `offset timestamp ${tokyo} must be accepted`);
    const body = await res.json();
    assert.ok(
      body.messages.length >= 2,
      "an offset timestamp must resolve to the same instant as its UTC equivalent"
    );
  });
});
