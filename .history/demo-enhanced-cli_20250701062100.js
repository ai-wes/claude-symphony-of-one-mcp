#!/usr/bin/env node

// Demo script for Symphony of One MCP Enhanced CLI Features
// This script demonstrates the new role management, templates, and quick assignments

import {
  AGENT_ROLES,
  TASK_TEMPLATES,
  QUICK_ASSIGNMENTS,
  getRolesByCategory,
} from "./role-templates.js";
import chalk from "chalk";

console.log(
  chalk.green(`
🎭 Symphony of One MCP - Enhanced CLI Demo
===========================================
`)
);

console.log(chalk.cyan("🎯 New Features in v2.0:"));
console.log(chalk.yellow("• Advanced Role Management System"));
console.log(chalk.yellow("• Task Templates & Quick Assignments"));
console.log(chalk.yellow("• Tab Completion & Interactive Menus"));
console.log(chalk.yellow("• IntelliSense-like Command Completion"));

console.log(chalk.cyan("\n🎭 Available Agent Roles by Category:\n"));

const categories = [
  "Development",
  "Analysis",
  "Management",
  "Quality",
  "Operations",
  "Documentation",
  "Research",
];

categories.forEach((category) => {
  console.log(chalk.green(`${category}:`));
  const roles = getRolesByCategory(category);
  Object.entries(roles).forEach(([key, role]) => {
    console.log(chalk.gray(`  • ${role.name} - ${role.description}`));
    console.log(
      chalk.gray(`    Capabilities: ${role.capabilities.join(", ")}`)
    );
    console.log(chalk.gray(`    Priority: ${role.priority}\n`));
  });
});

console.log(chalk.cyan("📋 Available Task Templates:\n"));

Object.entries(TASK_TEMPLATES).forEach(([key, template]) => {
  console.log(chalk.green(`${key}:`));
  console.log(chalk.gray(`  Title: ${template.title}`));
  console.log(
    chalk.gray(
      `  Priority: ${template.priority} | Est. Hours: ${template.estimatedHours}`
    )
  );
  console.log(chalk.gray(`  Assigned Role: ${template.assignedRole || "Any"}`));
  console.log(chalk.gray(`  Checklist Items: ${template.checklist.length}\n`));
});

console.log(chalk.cyan("⚡ Quick Assignment Types:\n"));

Object.entries(QUICK_ASSIGNMENTS).forEach(([key, assignment]) => {
  console.log(chalk.green(`${assignment.title}:`));
  console.log(
    chalk.gray(`  Command: /quick ${key.toLowerCase().replace("_", "")}`)
  );
  console.log(chalk.gray(`  Priority: ${assignment.priority}`));
  console.log(
    chalk.gray(
      `  Suggested Roles: ${assignment.suggestedRoles
        .map((roleKey) => {
          const role = AGENT_ROLES[roleKey];
          return role ? role.name : roleKey;
        })
        .join(", ")}\n`
    )
  );
});

console.log(chalk.cyan("🚀 Enhanced CLI Usage Examples:\n"));

const examples = [
  {
    title: "Role Assignment Workflow",
    commands: [
      "npm run cli",
      "/join development-team",
      "/role assign",
      "# Interactive menu appears",
      "# Select: Agent -> John",
      "# Select: Category -> Development",
      "# Select: Role -> Senior Developer",
      "# System sends role prompt to John",
    ],
  },
  {
    title: "Quick Bug Fix Assignment",
    commands: [
      "/quick bug",
      "# Shows suggested roles: Senior Developer, Backend Engineer",
      "# Shows agents with matching roles",
      "# Enter details: 'Login authentication failure'",
      "# Assigns to appropriate agent with urgent notification",
    ],
  },
  {
    title: "Template-Based Task Creation",
    commands: [
      "/template use CODE_REVIEW",
      "# Enter feature_name: 'payment integration'",
      "# System suggests Senior Developer",
      "# Creates structured task with checklist",
      "# Sends detailed assignment to agent",
    ],
  },
  {
    title: "Tab Completion Demo",
    commands: [
      "/ro[TAB]      # Completes to /role",
      "/role a[TAB]  # Completes to /role assign",
      "/qu[TAB]      # Completes to /quick",
      "/quick b[TAB] # Completes to /quick bug",
    ],
  },
];

examples.forEach((example) => {
  console.log(chalk.yellow(`${example.title}:`));
  example.commands.forEach((cmd) => {
    if (cmd.startsWith("#")) {
      console.log(chalk.gray(`  ${cmd}`));
    } else {
      console.log(chalk.green(`  ${cmd}`));
    }
  });
  console.log();
});

console.log(chalk.cyan("💡 Key Benefits:\n"));

const benefits = [
  "⚡ Faster task assignment with role matching",
  "📋 Consistent workflows through templates",
  "🎯 Clear agent responsibilities and capabilities",
  "⌨️  Improved UX with tab completion and menus",
  "🔄 Scalable collaboration framework",
  "📊 Better task tracking and organization",
];

benefits.forEach((benefit) => console.log(chalk.green(`  ${benefit}`)));

console.log(chalk.cyan("\n🎭 Ready to try the enhanced CLI? Run:"));
console.log(chalk.green("npm run cli"));
console.log(chalk.gray("Then use TAB completion and try the new commands!\n"));

console.log(
  chalk.yellow("📚 For detailed documentation, see: ROLE_MANAGEMENT_GUIDE.md")
);
