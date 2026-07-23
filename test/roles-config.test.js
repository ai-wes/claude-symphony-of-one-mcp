// TDD: roles-config.test.js
// Tests for the ROLES_CONFIG env-var config-loading mechanism.
// Since role-templates.js reads config at module load, each case runs the module
// in a child process (spawn node --input-type=module) with the appropriate env.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = new URL("..", import.meta.url).pathname;

function runInChild(code, env = {}) {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module"],
    {
      input: code,
      cwd: REPO,
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout: 10000,
    }
  );
  if (result.error) throw result.error;
  return result;
}

// ─── Case (a): no ROLES_CONFIG → generic defaults ────────────────────────────

test("without ROLES_CONFIG, generic defaults load (SENIOR_DEVELOPER present)", () => {
  const { stdout, stderr, status } = runInChild(`
import { getRole, getRoleNames } from "./role-templates.js";
const names = getRoleNames();
process.stdout.write(JSON.stringify({ names, hasSenior: !!getRole("SENIOR_DEVELOPER") }));
  `, { ROLES_CONFIG: "" });

  assert.equal(status, 0, `child exited non-zero. stderr: ${stderr}`);
  const out = JSON.parse(stdout);
  assert.ok(out.hasSenior, "SENIOR_DEVELOPER should exist in generic defaults");
  assert.ok(!out.names.includes("COMPANION"), "COMPANION should not appear in generic defaults");
});

test("without ROLES_CONFIG, all 11 generic roles present", () => {
  const { stdout, stderr, status } = runInChild(`
import { getRoleNames } from "./role-templates.js";
process.stdout.write(JSON.stringify(getRoleNames().sort()));
  `, { ROLES_CONFIG: "" });

  assert.equal(status, 0, `child exited non-zero. stderr: ${stderr}`);
  const names = JSON.parse(stdout);
  const expected = [
    "BACKEND_ENGINEER", "DATA_ANALYST", "DEVOPS_ENGINEER",
    "FRONTEND_SPECIALIST", "PROJECT_MANAGER", "QA_ENGINEER",
    "RESEARCH_ANALYST", "SCRUM_MASTER", "SECURITY_ANALYST",
    "SENIOR_DEVELOPER", "TECHNICAL_WRITER",
  ].sort();
  assert.deepEqual(names, expected);
});

// ─── Case (b): ROLES_CONFIG points at custom JSON → custom roster loads ──────

test("with ROLES_CONFIG pointing at a custom fixture, getRoleNames() reflects the custom roster", () => {
  // Write a temp fixture with one custom role
  const fixture = {
    roles: {
      CUSTOM_AGENT: {
        name: "Custom Agent",
        category: "Custom",
        description: "A test-only role",
        prompt: "You are a custom agent for testing.",
        capabilities: ["testing"],
        defaultTasks: ["do stuff"],
        priority: "low",
      },
    },
    taskTemplates: {},
    quickAssignments: {},
  };
  const fixturePath = join(tmpdir(), `symphony-test-fixture-${Date.now()}.json`);
  writeFileSync(fixturePath, JSON.stringify(fixture));

  try {
    const { stdout, stderr, status } = runInChild(`
import { getRoleNames, getRole } from "./role-templates.js";
const names = getRoleNames();
const role = getRole("CUSTOM_AGENT");
process.stdout.write(JSON.stringify({ names, roleName: role?.name }));
    `, { ROLES_CONFIG: fixturePath });

    assert.equal(status, 0, `child exited non-zero. stderr: ${stderr}`);
    const out = JSON.parse(stdout);
    assert.deepEqual(out.names, ["CUSTOM_AGENT"]);
    assert.equal(out.roleName, "Custom Agent");
  } finally {
    try { unlinkSync(fixturePath); } catch (_) {}
  }
});

test("with ROLES_CONFIG pointing at an invalid path, falls back to generic defaults with a warning", () => {
  const { stdout, stderr, status } = runInChild(`
import { getRole } from "./role-templates.js";
process.stdout.write(JSON.stringify({ hasSenior: !!getRole("SENIOR_DEVELOPER") }));
  `, { ROLES_CONFIG: "/nonexistent/path/does-not-exist.json" });

  assert.equal(status, 0, "should not crash — falls back to defaults");
  const out = JSON.parse(stdout);
  assert.ok(out.hasSenior, "Should have fallen back to generic defaults");
  assert.ok(stderr.includes("Warning"), "Should emit a warning to stderr");
});
