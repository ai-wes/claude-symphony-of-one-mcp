/**
 * Smoke test for cli.js — the human-facing orchestrator console.
 *
 * 1518 lines with no coverage. It is the third client of the same REST API
 * (alongside the MCP transport and the tests), and it hardcodes its own URLs —
 * exactly the configuration that hid the create_task 404 for the life of the
 * project. Its paths grep clean, but grepping is what missed the transport
 * bugs too.
 *
 * The CLI is an interactive readline REPL, so this drives it the way a person
 * would: spawn it with stdin piped, feed slash commands, and assert on what it
 * prints. Commands that open inquirer sub-prompts (/role assign, /quick,
 * /template) are deliberately avoided — they need a TTY.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startServer } from "./helpers.js";

const CLI_JS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../cli.js"
);

/**
 * Run cli.js against a hub, feed it lines, and collect its output.
 * Lines are sent with a small delay so each command's async work can land.
 */
function runCli(serverUrl, lines, { settleMs = 400 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_JS], {
      env: {
        ...process.env,
        CHAT_SERVER_URL: serverUrl,
        SHARED_DIR: path.join(os.tmpdir(), `cli-shared-${randomUUID()}`),
        FORCE_COLOR: "0",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    const done = (code) => resolve({ stdout, stderr, code });
    child.on("exit", done);

    (async () => {
      // Let the banner and initial /stats call settle.
      await new Promise((r) => setTimeout(r, settleMs * 2));
      for (const line of lines) {
        child.stdin.write(line + "\n");
        await new Promise((r) => setTimeout(r, settleMs));
      }
      child.stdin.end();
      // Backstop in case /quit does not exit.
      setTimeout(() => child.kill("SIGTERM"), 3000);
    })();
  });
}

describe("cli.js smoke", () => {
  let srv;
  let url;
  const room = `cli-room-${randomUUID().slice(0, 6)}`;

  before(async () => {
    srv = await startServer();
    url = `http://localhost:${srv.port}`;
  });

  after(async () => {
    await srv.stop();
  });

  it("starts, connects to the hub, and reports stats without crashing", async () => {
    const { stdout, stderr } = await runCli(url, ["/help", "/quit"]);
    assert.match(stdout, /MCP Orchestrator/, "banner should render");
    assert.match(stdout, new RegExp(`Hub Server: ${url}`));
    assert.match(stdout, /Orchestrator Commands/, "/help should list commands");
    assert.ok(
      !/Cannot read propert|is not a function|ReferenceError|TypeError/.test(
        stdout + stderr
      ),
      `CLI raised a runtime error:\n${stderr || stdout}`
    );
  });

  it("joins a room and lists it", async () => {
    const { stdout, stderr } = await runCli(url, [
      `/join ${room}`,
      "/rooms",
      "/agents",
      "/quit",
    ]);
    assert.match(stdout, new RegExp(room), "joined room should be named back");
    assert.ok(
      !/Failed to (join|list)/.test(stdout),
      `join/list reported a failure:\n${stdout}`
    );
    assert.ok(
      !/ReferenceError|TypeError/.test(stdout + stderr),
      `runtime error:\n${stderr}`
    );
  });

  it("creates a task through the CLI and it reaches the hub", async () => {
    const title = `cli-task-${randomUUID().slice(0, 6)}`;
    // /task create takes no arguments — it prompts for each field in turn:
    // title, description, priority (blank = medium), assignee (blank = none).
    const { stdout, stderr } = await runCli(url, [
      `/join ${room}`,
      "/task create",
      title,
      "created from the CLI smoke test",
      "",
      "",
      "/quit",
    ]);

    assert.ok(
      !/Failed to create|404|ReferenceError|TypeError/.test(stdout + stderr),
      `task creation reported an error:\n${stdout}\n${stderr}`
    );

    // The real assertion: the hub actually has it. This is the check that
    // would have caught the transport's create_task 404.
    const body = await (await fetch(`${url}/api/tasks/${room}`)).json();
    const titles = (body.tasks || []).map((t) => t.title);
    assert.ok(
      titles.some((t) => t.includes(title)),
      `task created via CLI should exist on the hub; hub has ${JSON.stringify(titles)}`
    );
  });

  it("sends a message that lands in room history", async () => {
    const marker = `cli-hello-${randomUUID().slice(0, 6)}`;
    const { stdout, stderr } = await runCli(url, [
      `/join ${room}`,
      marker,
      "/quit",
    ]);
    assert.ok(
      !/ReferenceError|TypeError/.test(stdout + stderr),
      `runtime error:\n${stderr}`
    );

    const body = await (await fetch(`${url}/api/messages/${room}`)).json();
    assert.ok(
      body.messages.map((m) => m.content).includes(marker),
      "a plain line typed at the CLI should be sent to the room"
    );
  });

  it("lists roles and templates without a TTY", async () => {
    const { stdout, stderr } = await runCli(url, [
      "/role list",
      "/template",
      "/quit",
    ]);
    assert.ok(
      !/ReferenceError|TypeError|Cannot read propert/.test(stdout + stderr),
      `role/template listing raised an error:\n${stderr || stdout}`
    );
  });

  it("handles an unknown command without crashing", async () => {
    const { stdout, stderr } = await runCli(url, ["/definitely-not-a-command", "/quit"]);
    assert.ok(
      !/ReferenceError|TypeError/.test(stdout + stderr),
      `unknown command crashed the CLI:\n${stderr}`
    );
  });
});
