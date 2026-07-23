import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_ROLES,
  TASK_TEMPLATES,
  QUICK_ASSIGNMENTS,
  DEFAULT_ROLES,
  DEFAULT_TASK_TEMPLATES,
  DEFAULT_QUICK_ASSIGNMENTS,
  getRole,
  getRoleNames,
  getRolesByCategory,
  getCategories,
  getTaskTemplate,
  formatTaskFromTemplate,
  getQuickAssignment,
} from "../role-templates.js";

// When ROLES_CONFIG is unset (as it is in a plain `node --test` run),
// AGENT_ROLES should be the generic upstream defaults.
const GENERIC_ROLES = [
  "SENIOR_DEVELOPER",
  "FRONTEND_SPECIALIST",
  "BACKEND_ENGINEER",
  "DATA_ANALYST",
  "SECURITY_ANALYST",
  "PROJECT_MANAGER",
  "SCRUM_MASTER",
  "QA_ENGINEER",
  "DEVOPS_ENGINEER",
  "TECHNICAL_WRITER",
  "RESEARCH_ANALYST",
];

test("generic defaults: SENIOR_DEVELOPER exists and is well-formed", () => {
  const r = getRole("SENIOR_DEVELOPER");
  assert.ok(r, "SENIOR_DEVELOPER missing");
  for (const field of ["name", "category", "description", "prompt", "capabilities", "defaultTasks", "priority"]) {
    assert.ok(r[field] !== undefined, `SENIOR_DEVELOPER.${field} missing`);
  }
  assert.ok(Array.isArray(r.capabilities) && r.capabilities.length > 0);
  assert.ok(Array.isArray(r.defaultTasks) && r.defaultTasks.length > 0);
});

test("generic defaults: exactly the 11 upstream roles are present (no Aeonia roles)", () => {
  assert.deepEqual(getRoleNames().sort(), [...GENERIC_ROLES].sort());
  // Aeonia-specific roles must NOT be present in the generic defaults
  for (const aeonaRole of ["COMPANION", "COORDINATOR", "MU_PM", "SCRIBE"]) {
    assert.equal(getRole(aeonaRole), undefined, `${aeonaRole} should not be in generic defaults`);
  }
});

test("every generic role is well-formed", () => {
  for (const key of GENERIC_ROLES) {
    const r = getRole(key);
    assert.ok(r, `${key} missing`);
    for (const field of ["name", "category", "description", "prompt", "capabilities", "defaultTasks", "priority"]) {
      assert.ok(r[field] !== undefined, `${key}.${field} missing`);
    }
    assert.ok(Array.isArray(r.capabilities) && r.capabilities.length > 0);
    assert.ok(Array.isArray(r.defaultTasks) && r.defaultTasks.length > 0);
  }
});

test("DEFAULT_ROLES matches AGENT_ROLES when no config is set", () => {
  assert.deepEqual(Object.keys(AGENT_ROLES).sort(), Object.keys(DEFAULT_ROLES).sort());
});

test("getRolesByCategory returns correct subset", () => {
  const dev = getRolesByCategory("Development");
  assert.ok(Object.keys(dev).includes("SENIOR_DEVELOPER"));
  assert.ok(Object.keys(dev).includes("FRONTEND_SPECIALIST"));
  assert.ok(Object.keys(dev).includes("BACKEND_ENGINEER"));
});

test("getCategories returns all unique categories", () => {
  const cats = getCategories();
  assert.ok(Array.isArray(cats));
  assert.ok(cats.includes("Development"));
  assert.ok(cats.includes("Analysis"));
  assert.ok(cats.includes("Management"));
  assert.equal(cats.length, new Set(cats).size);
});

test("no task template references a non-existent role (dangling-ref guard)", () => {
  for (const [k, t] of Object.entries(TASK_TEMPLATES)) {
    if (t.assignedRole !== null && t.assignedRole !== undefined) {
      assert.ok(AGENT_ROLES[t.assignedRole], `TASK_TEMPLATES.${k}.assignedRole '${t.assignedRole}' is not a real role`);
    }
  }
});

test("no quick assignment references a non-existent role or template", () => {
  for (const [k, q] of Object.entries(QUICK_ASSIGNMENTS)) {
    for (const r of q.suggestedRoles || []) {
      assert.ok(AGENT_ROLES[r], `QUICK_ASSIGNMENTS.${k} suggests non-existent role '${r}'`);
    }
    assert.ok(getTaskTemplate(q.template), `QUICK_ASSIGNMENTS.${k}.template '${q.template}' is not a real template`);
  }
});

test("formatTaskFromTemplate substitutes variables", () => {
  const t = formatTaskFromTemplate("BUG_FIX", { bug_description: "login crash" });
  assert.ok(t.title.includes("login crash"));
  assert.ok(!t.title.includes("{bug_description}"));
});

test("formatTaskFromTemplate returns null for unknown template", () => {
  assert.equal(formatTaskFromTemplate("NONEXISTENT"), null);
});

test("getQuickAssignment resolves EMERGENCY_BUG_FIX", () => {
  const q = getQuickAssignment("EMERGENCY_BUG_FIX");
  assert.ok(q);
  assert.equal(q.priority, "critical");
});

test("DEFAULT_TASK_TEMPLATES and DEFAULT_QUICK_ASSIGNMENTS are exported", () => {
  assert.ok(typeof DEFAULT_TASK_TEMPLATES === "object");
  assert.ok(typeof DEFAULT_QUICK_ASSIGNMENTS === "object");
  assert.ok(Object.keys(DEFAULT_TASK_TEMPLATES).length > 0);
  assert.ok(Object.keys(DEFAULT_QUICK_ASSIGNMENTS).length > 0);
});
