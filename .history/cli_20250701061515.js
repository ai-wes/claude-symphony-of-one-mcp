#!/usr/bin/env node
import readline from "readline";
import axios from "axios";
import { io } from "socket.io-client";
import chalk from "chalk";
import { v4 as uuidv4 } from "uuid";
import inquirer from "inquirer";
import {
  AGENT_ROLES,
  TASK_TEMPLATES,
  QUICK_ASSIGNMENTS,
  getRolesByCategory,
  getRoleNames,
  getRole,
  formatTaskFromTemplate,
  getQuickAssignment,
} from "./role-templates.js";

const SERVER_URL = process.env.CHAT_SERVER_URL || "http://localhost:3000";

class OrchestratorCLI {
  constructor() {
    this.socket = null;
    this.currentRoom = null;
    this.agentId = `orchestrator-${uuidv4()}`;
    this.agentName = "Orchestrator";
    this.isOrchestrator = true;
    this.agentRoles = new Map(); // Track assigned roles for agents
    this.commandHistory = [];
    this.setupReadline();
  }

  setupReadline() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan("🎭 > "),
      completer: this.completer.bind(this),
    });

    // Enable tab completion
    this.rl.on("SIGINT", () => {
      console.log("\n");
      this.rl.question("Really exit? (y/n) ", (answer) => {
        if (answer.match(/^y(es)?$/i)) {
          if (this.socket) this.socket.disconnect();
          console.log(chalk.gray("Goodbye!"));
          process.exit(0);
        } else {
          this.rl.prompt();
        }
      });
    });
  }

  // Tab completion function
  completer(line) {
    const commands = [
      "/help",
      "/join",
      "/leave",
      "/rooms",
      "/agents",
      "/history",
      "/task",
      "/broadcast",
      "/stats",
      "/assign",
      "/monitor",
      "/tag",
      "/logs",
      "/memory",
      "/notifications",
      "/name",
      "/clear",
      "/quit",
      "/role",
      "/template",
      "/quick",
      "/roles",
    ];

    const subCommands = {
      "/task": ["create", "list", "update", "template"],
      "/role": ["assign", "list", "create", "remove", "prompt"],
      "/template": ["list", "use", "create"],
      "/quick": ["bug", "security", "feature", "performance", "review"],
      "/logs": ["all", "info", "error", "debug"],
      "/memory": ["list", "clear"],
      "/notifications": ["all", "unread"],
    };

    const hits = commands.filter((c) => c.startsWith(line));

    // Check for sub-commands
    const parts = line.split(" ");
    if (parts.length === 2 && subCommands[parts[0]]) {
      const subHits = subCommands[parts[0]]
        .filter((sc) => sc.startsWith(parts[1]))
        .map((sc) => `${parts[0]} ${sc}`);
      return [subHits.length ? subHits : hits, line];
    }

    return [hits.length ? hits : commands, line];
  }

  async start() {
    console.log(
      chalk.green(`\n
  ______   ____  __ ____  _   _  ___  _   ___   __   ___  _____    ___  _   _ _____ 
 / ___\\ \\ / /  \\/  |  _ \\| | | |/ _ \\| \\ | \\ \\ / /  / _ \\|  ___|  / _ \\| \\ | | ____|
 \\___ \\\\ V /| |\\/| | |_) | |_| | | | |  \\| |\\ V /  | | | | |_    | | | |  \\| |  _|  
  ___) || | | |  | |  __/|  _  | |_| | |\\  | | |   | |_| |  _|   | |_| | |\\  | |___ 
 |____/ |_| |_|  |_|_|   |_| |_|\\___/|_| \\_| |_|    \\___/|_|      \\___/|_| \\_|_____|
                            MCP Orchestrator v2.0`)
    );
    console.log(chalk.gray(`   Hub Server: ${SERVER_URL}`));
    console.log(chalk.yellow(`   Role: User/Orchestrator\n`));
    console.log(
      chalk.cyan(`   💡 Use TAB for auto-completion, type /help for commands\n`)
    );

    await this.setupHandlers();
    await this.showStats();
    this.showQuickStart();
    this.rl.prompt();
  }

  showQuickStart() {
    console.log(chalk.yellow("🚀 Quick Start:"));
    console.log(chalk.gray("  • /join <room>     - Join a collaboration room"));
    console.log(chalk.gray("  • /role assign     - Assign roles to agents"));
    console.log(chalk.gray("  • /quick          - Quick task assignments"));
    console.log(chalk.gray("  • /template       - Use task templates"));
    console.log(chalk.gray("  • TAB key         - Auto-complete commands\n"));
  }

  async setupHandlers() {
    this.rl.on("line", async (line) => {
      const input = line.trim();
      this.commandHistory.push(input);

      if (input.startsWith("/")) {
        await this.handleCommand(input);
      } else if (this.currentRoom) {
        await this.sendMessage(input);
      } else {
        console.log(
          chalk.yellow("Not in a room. Use /join <room> to join a room.")
        );
      }

      this.rl.prompt();
    });

    this.rl.on("close", () => {
      if (this.socket) this.socket.disconnect();
      console.log(chalk.gray("\nGoodbye!"));
      process.exit(0);
    });
  }

  async handleCommand(input) {
    const [command, ...args] = input.split(" ");

    switch (command) {
      case "/help":
      case "/h":
        this.showHelp();
        break;

      case "/join":
      case "/j":
        await this.joinRoom(args[0]);
        break;

      case "/leave":
      case "/l":
        await this.leaveRoom();
        break;

      case "/rooms":
      case "/r":
        await this.listRooms();
        break;

      case "/agents":
      case "/a":
        await this.listAgents();
        break;

      case "/history":
      case "/hist":
        await this.showHistory(args[0]);
        break;

      case "/task":
        await this.handleTaskCommand(args);
        break;

      case "/role":
        await this.handleRoleCommand(args);
        break;

      case "/template":
        await this.handleTemplateCommand(args);
        break;

      case "/quick":
        await this.handleQuickCommand(args);
        break;

      case "/roles":
        await this.listAllRoles();
        break;

      case "/broadcast":
      case "/bc":
        await this.broadcast(args.join(" "));
        break;

      case "/stats":
      case "/st":
        await this.showStats();
        break;

      case "/assign":
        await this.assignTask(args);
        break;

      case "/monitor":
      case "/mon":
        await this.monitorMode(args[0]);
        break;

      case "/tag":
        await this.tagAgent(args);
        break;

      case "/logs":
        await this.viewLogs(args[0]);
        break;

      case "/memory":
      case "/mem":
        await this.manageMemory(args);
        break;

      case "/notifications":
      case "/notif":
        await this.viewNotifications(args[0]);
        break;

      case "/name":
        this.agentName = args.join(" ") || "Orchestrator";
        console.log(chalk.green(`Name set to: ${this.agentName}`));
        break;

      case "/clear":
        console.clear();
        await this.showStats();
        this.showQuickStart();
        break;

      case "/quit":
      case "/q":
        this.rl.close();
        break;

      default:
        console.log(chalk.red(`Unknown command: ${command}`));
        console.log(
          chalk.gray(
            "Use TAB for auto-completion or /help for available commands"
          )
        );
    }
  }

  // New Role Management Commands
  async handleRoleCommand(args) {
    const [subCommand, ...params] = args;

    switch (subCommand) {
      case "assign":
        await this.assignRoleToAgent();
        break;
      case "list":
        await this.listAgentRoles();
        break;
      case "create":
        await this.createCustomRole();
        break;
      case "remove":
        await this.removeAgentRole(params[0]);
        break;
      case "prompt":
        await this.sendRolePrompt(params[0]);
        break;
      default:
        console.log(chalk.yellow("Role commands:"));
        console.log("  /role assign  - Assign a role to an agent");
        console.log("  /role list    - List all agent role assignments");
        console.log("  /role create  - Create a custom role");
        console.log("  /role remove <agent> - Remove role from agent");
        console.log(
          "  /role prompt <agent> - Send role-specific prompt to agent"
        );
    }
  }

  async assignRoleToAgent() {
    if (!this.currentRoom) {
      console.log(chalk.red("Please join a room first"));
      return;
    }

    try {
      // Get available agents
      const response = await axios.get(
        `${SERVER_URL}/api/agents/${this.currentRoom}`
      );
      const agents = response.data.filter((agent) => agent.id !== this.agentId);

      if (agents.length === 0) {
        console.log(chalk.yellow("No other agents in this room"));
        return;
      }

      // Interactive role assignment
      const answers = await inquirer.prompt([
        {
          type: "list",
          name: "agent",
          message: "Select agent to assign role:",
          choices: agents.map((agent) => ({
            name: `${agent.name} (${agent.id})`,
            value: agent,
          })),
        },
        {
          type: "list",
          name: "category",
          message: "Select role category:",
          choices: [
            "Development",
            "Analysis",
            "Management",
            "Quality",
            "Operations",
            "Documentation",
            "Research",
          ],
        },
      ]);

      const categoryRoles = getRolesByCategory(answers.category);
      const roleChoices = Object.entries(categoryRoles).map(([key, role]) => ({
        name: `${role.name} - ${role.description}`,
        value: key,
      }));

      const roleAnswer = await inquirer.prompt([
        {
          type: "list",
          name: "roleKey",
          message: "Select specific role:",
          choices: roleChoices,
        },
      ]);

      const role = getRole(roleAnswer.roleKey);
      this.agentRoles.set(answers.agent.id, {
        ...role,
        key: roleAnswer.roleKey,
        assignedAt: new Date(),
      });

      // Send role prompt to agent
      await this.sendRoleAssignmentMessage(answers.agent, role);

      console.log(
        chalk.green(`✓ Assigned role "${role.name}" to ${answers.agent.name}`)
      );
    } catch (error) {
      console.log(chalk.red(`Error assigning role: ${error.message}`));
    }
  }

  async sendRoleAssignmentMessage(agent, role) {
    const message =
      `🎭 **Role Assignment**\n\n` +
      `You have been assigned the role of **${role.name}**.\n\n` +
      `**Role Description:** ${role.description}\n\n` +
      `**Your Responsibilities:**\n${role.prompt}\n\n` +
      `**Key Capabilities:** ${role.capabilities.join(", ")}\n\n` +
      `**Default Tasks:**\n${role.defaultTasks
        .map((task) => `• ${task}`)
        .join("\n")}\n\n` +
      `Please acknowledge this role assignment and let me know if you have any questions.`;

    await this.tagSpecificAgent(agent.name, message);
  }

  async listAgentRoles() {
    if (this.agentRoles.size === 0) {
      console.log(chalk.yellow("No role assignments yet"));
      return;
    }

    console.log(chalk.cyan("\n🎭 Agent Role Assignments:"));
    for (const [agentId, roleData] of this.agentRoles.entries()) {
      console.log(chalk.green(`  ${agentId}:`));
      console.log(chalk.gray(`    Role: ${roleData.name}`));
      console.log(chalk.gray(`    Category: ${roleData.category}`));
      console.log(
        chalk.gray(`    Assigned: ${roleData.assignedAt.toLocaleString()}`)
      );
    }
  }

  async listAllRoles() {
    console.log(chalk.cyan("\n🎭 Available Agent Roles:\n"));

    const categories = [
      "Development",
      "Analysis",
      "Management",
      "Quality",
      "Operations",
      "Documentation",
      "Research",
    ];

    for (const category of categories) {
      console.log(chalk.yellow(`${category}:`));
      const roles = getRolesByCategory(category);

      Object.entries(roles).forEach(([key, role]) => {
        console.log(chalk.green(`  ${role.name}`));
        console.log(chalk.gray(`    ${role.description}`));
        console.log(
          chalk.gray(
            `    Priority: ${role.priority} | Capabilities: ${role.capabilities.length}`
          )
        );
      });
      console.log();
    }
  }

  // Template Management
  async handleTemplateCommand(args) {
    const [subCommand, ...params] = args;

    switch (subCommand) {
      case "list":
        await this.listTaskTemplates();
        break;
      case "use":
        await this.useTaskTemplate(params[0]);
        break;
      case "create":
        await this.createCustomTemplate();
        break;
      default:
        console.log(chalk.yellow("Template commands:"));
        console.log("  /template list    - List available task templates");
        console.log("  /template use     - Use a task template");
        console.log("  /template create  - Create a custom template");
    }
  }

  async listTaskTemplates() {
    console.log(chalk.cyan("\n📋 Available Task Templates:\n"));

    Object.entries(TASK_TEMPLATES).forEach(([key, template]) => {
      console.log(chalk.green(`${key}:`));
      console.log(chalk.gray(`  Title: ${template.title}`));
      console.log(
        chalk.gray(
          `  Priority: ${template.priority} | Est. Hours: ${template.estimatedHours}`
        )
      );
      console.log(
        chalk.gray(`  Assigned Role: ${template.assignedRole || "Any"}`)
      );
      console.log(
        chalk.gray(`  Checklist Items: ${template.checklist.length}`)
      );
      console.log();
    });
  }

  async useTaskTemplate(templateKey) {
    if (!this.currentRoom) {
      console.log(chalk.red("Please join a room first"));
      return;
    }

    const template = TASK_TEMPLATES[templateKey];
    if (!template) {
      console.log(
        chalk.red(
          "Template not found. Use /template list to see available templates"
        )
      );
      return;
    }

    // Get variable values for template
    const variables = this.extractVariables(
      template.title + " " + template.description
    );
    const variableValues = {};

    for (const variable of variables) {
      const answer = await inquirer.prompt([
        {
          type: "input",
          name: "value",
          message: `Enter value for ${variable}:`,
          validate: (input) => input.trim() !== "" || "Value cannot be empty",
        },
      ]);
      variableValues[variable] = answer.value;
    }

    const formattedTask = formatTaskFromTemplate(templateKey, variableValues);

    // Suggest agents based on role
    let suggestedAgent = null;
    if (formattedTask.assignedRole) {
      const agentWithRole = Array.from(this.agentRoles.entries()).find(
        ([_, role]) => role.key === formattedTask.assignedRole
      );
      if (agentWithRole) {
        suggestedAgent = agentWithRole[0];
      }
    }

    console.log(chalk.green("\n✨ Generated Task from Template:"));
    console.log(chalk.cyan(`Title: ${formattedTask.title}`));
    console.log(chalk.gray(`Description: ${formattedTask.description}`));
    console.log(chalk.gray(`Priority: ${formattedTask.priority}`));
    if (suggestedAgent) {
      console.log(chalk.green(`Suggested Agent: ${suggestedAgent}`));
    }

    const confirm = await inquirer.prompt([
      {
        type: "confirm",
        name: "create",
        message: "Create this task?",
        default: true,
      },
    ]);

    if (confirm.create) {
      await this.createTaskFromTemplate(formattedTask, suggestedAgent);
    }
  }

  extractVariables(text) {
    const matches = text.match(/{([^}]+)}/g);
    return matches ? matches.map((match) => match.slice(1, -1)) : [];
  }

  async createTaskFromTemplate(task, suggestedAgent) {
    try {
      const taskData = {
        title: task.title,
        description: task.description,
        priority: task.priority,
        assignedTo: suggestedAgent,
        room: this.currentRoom,
        createdBy: this.agentId,
        checklist: task.checklist,
        estimatedHours: task.estimatedHours,
      };

      const response = await axios.post(`${SERVER_URL}/api/tasks`, taskData);
      console.log(chalk.green("✓ Task created successfully from template"));

      if (suggestedAgent) {
        await this.tagSpecificAgent(
          suggestedAgent,
          `📋 **New Task Assigned**\n\n**${task.title}**\n\n${task.description}\n\nThis task was created from a template and matches your assigned role. Please acknowledge receipt and estimated completion time.`
        );
      }
    } catch (error) {
      console.log(chalk.red(`Error creating task: ${error.message}`));
    }
  }

  // Quick Assignment Commands
  async handleQuickCommand(args) {
    const [type] = args;

    const quickTypes = {
      bug: "EMERGENCY_BUG_FIX",
      security: "SECURITY_INCIDENT",
      feature: "NEW_FEATURE_REQUEST",
      performance: "PERFORMANCE_ISSUE",
      review: "CODE_REVIEW_REQUEST",
    };

    if (!type || !quickTypes[type]) {
      console.log(chalk.yellow("Quick assignment types:"));
      console.log("  /quick bug         - Emergency bug fix");
      console.log("  /quick security    - Security incident");
      console.log("  /quick feature     - New feature request");
      console.log("  /quick performance - Performance issue");
      console.log("  /quick review      - Code review");
      return;
    }

    await this.createQuickAssignment(quickTypes[type]);
  }

  async createQuickAssignment(assignmentKey) {
    if (!this.currentRoom) {
      console.log(chalk.red("Please join a room first"));
      return;
    }

    const assignment = getQuickAssignment(assignmentKey);
    if (!assignment) {
      console.log(chalk.red("Assignment type not found"));
      return;
    }

    console.log(chalk.yellow(`\n${assignment.title}`));
    console.log(chalk.gray(assignment.description));

    // Show suggested roles
    console.log(chalk.cyan("\nSuggested roles:"));
    assignment.suggestedRoles.forEach((roleKey) => {
      const role = getRole(roleKey);
      if (role) {
        console.log(chalk.green(`  • ${role.name} - ${role.description}`));
      }
    });

    // Find agents with matching roles
    const matchingAgents = Array.from(this.agentRoles.entries())
      .filter(([_, role]) => assignment.suggestedRoles.includes(role.key))
      .map(([agentId, role]) => ({ agentId, role }));

    if (matchingAgents.length > 0) {
      console.log(chalk.cyan("\nAgents with matching roles:"));
      matchingAgents.forEach(({ agentId, role }) => {
        console.log(chalk.green(`  • ${agentId} (${role.name})`));
      });

      const agentAnswer = await inquirer.prompt([
        {
          type: "list",
          name: "selectedAgent",
          message: "Select agent for assignment:",
          choices: [
            ...matchingAgents.map(({ agentId, role }) => ({
              name: `${agentId} (${role.name})`,
              value: agentId,
            })),
            { name: "None - I'll assign manually", value: null },
          ],
        },
      ]);

      if (agentAnswer.selectedAgent) {
        await this.createQuickTask(assignment, agentAnswer.selectedAgent);
        return;
      }
    }

    // No matching agents or manual assignment
    const details = await inquirer.prompt([
      {
        type: "input",
        name: "details",
        message: "Enter specific details for this assignment:",
        validate: (input) => input.trim() !== "" || "Details cannot be empty",
      },
      {
        type: "input",
        name: "agent",
        message: "Agent to assign to (leave empty for unassigned):",
      },
    ]);

    await this.createQuickTask(
      assignment,
      details.agent || null,
      details.details
    );
  }

  async createQuickTask(assignment, assignedAgent, customDetails) {
    try {
      const taskData = {
        title: assignment.title,
        description: customDetails
          ? `${assignment.description}\n\n**Details:** ${customDetails}`
          : assignment.description,
        priority: assignment.priority,
        assignedTo: assignedAgent,
        room: this.currentRoom,
        createdBy: this.agentId,
        urgent: assignment.priority === "critical",
      };

      const response = await axios.post(`${SERVER_URL}/api/tasks`, taskData);
      console.log(
        chalk.green(`✓ Quick assignment created: ${assignment.title}`)
      );

      if (assignedAgent) {
        await this.tagSpecificAgent(
          assignedAgent,
          `🚨 **URGENT ASSIGNMENT**\n\n**${assignment.title}**\n\n${taskData.description}\n\nThis is a ${assignment.priority} priority task. Please respond immediately with your estimated time to completion.`
        );
      } else {
        await this.broadcast(
          `🚨 **${assignment.title}** - ${assignment.description}. Who can take this ${assignment.priority} priority task?`
        );
      }
    } catch (error) {
      console.log(
        chalk.red(`Error creating quick assignment: ${error.message}`)
      );
    }
  }

  async tagSpecificAgent(agentName, message) {
    try {
      const content = `@${agentName} ${message}`;
      const response = await axios.post(`${SERVER_URL}/api/send`, {
        room: this.currentRoom,
        sender: this.agentName,
        agentId: this.agentId,
        content,
        isOrchestrator: true,
      });

      console.log(chalk.green(`✓ Tagged ${agentName} with message`));
    } catch (error) {
      console.log(chalk.red(`Error tagging agent: ${error.message}`));
    }
  }

  showHelp() {
    console.log(chalk.yellow("\n🎭 Symphony of One Orchestrator Commands:"));

    console.log(chalk.cyan("\nRoom Management:"));
    console.log("  /join <room>        - Join a chat room");
    console.log("  /leave              - Leave current room");
    console.log("  /rooms              - List all rooms");
    console.log("  /agents             - List agents in current room");
    console.log("  /history [n]        - Show last n messages");

    console.log(chalk.cyan("\nRole Management:"));
    console.log("  /role assign        - Assign roles to agents");
    console.log("  /role list          - List agent role assignments");
    console.log("  /roles              - Show all available roles");
    console.log("  /role prompt <agent> - Send role-specific prompt");

    console.log(chalk.cyan("\nTask Management:"));
    console.log("  /task create        - Create a new task");
    console.log("  /task list          - List room tasks");
    console.log("  /template list      - Show task templates");
    console.log("  /template use <name> - Use a task template");

    console.log(chalk.cyan("\nQuick Assignments:"));
    console.log("  /quick bug          - Emergency bug fix assignment");
    console.log("  /quick security     - Security incident response");
    console.log("  /quick feature      - New feature development");
    console.log("  /quick performance  - Performance optimization");
    console.log("  /quick review       - Code review request");

    console.log(chalk.cyan("\nAgent Orchestration:"));
    console.log("  /broadcast <msg>    - Send message to all agents");
    console.log("  /tag <agent> <msg>  - Send tagged message to agent");
    console.log("  /assign <task>      - Assign task to specific agent");
    console.log("  /monitor [room]     - Monitor room activity");
    console.log("  /stats              - Show system statistics");

    console.log(chalk.cyan("\nSystem:"));
    console.log("  /name <name>        - Set your display name");
    console.log("  /clear              - Clear screen");
    console.log("  /help               - Show this help");
    console.log("  /quit               - Exit");

    console.log(chalk.gray("\n💡 Use TAB key for auto-completion of commands"));
    console.log(
      chalk.gray("💡 Use UP/DOWN arrows to navigate command history\n")
    );
  }

  async joinRoom(roomName) {
    if (!roomName) {
      console.log(chalk.red("Please specify a room name"));
      return;
    }

    try {
      const response = await axios.post(`${SERVER_URL}/api/join/${roomName}`, {
        agentId: this.agentId,
        agentName: this.agentName,
        capabilities: {
          role: "orchestrator",
          type: "human",
          permissions: ["broadcast", "assign_tasks", "monitor"],
        },
      });

      if (response.data.success) {
        this.currentRoom = roomName;
        this.connectSocket();

        console.log(chalk.green(`\n✓ Joined room: ${roomName}`));
        console.log(
          chalk.gray(`  ${response.data.currentAgents.length} agents in room\n`)
        );

        // Update prompt
        this.rl.setPrompt(chalk.cyan(`🎭 [${roomName}] > `));
      }
    } catch (error) {
      console.log(chalk.red(`Failed to join room: ${error.message}`));
    }
  }

  async leaveRoom() {
    if (!this.currentRoom) {
      console.log(chalk.yellow("Not in a room"));
      return;
    }

    try {
      await axios.post(`${SERVER_URL}/api/leave/${this.agentId}`);

      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
      }

      console.log(chalk.gray(`Left room: ${this.currentRoom}`));
      this.currentRoom = null;
      this.rl.setPrompt(chalk.cyan("🎭 > "));
    } catch (error) {
      console.log(chalk.red(`Failed to leave room: ${error.message}`));
    }
  }

  connectSocket() {
    if (this.socket) this.socket.disconnect();

    this.socket = io(SERVER_URL);

    this.socket.on("connect", () => {
      this.socket.emit("register", {
        agentId: this.agentId,
        room: this.currentRoom,
      });
    });

    this.socket.on("message", (message) => {
      // Don't show our own messages again
      if (message.agentId !== this.agentId) {
        this.displayMessage(message);
      }
    });

    this.socket.on("task", (data) => {
      console.log(chalk.magenta(`\n[Task ${data.type}] ${data.task.title}`));
      this.rl.prompt();
    });
  }

  displayMessage(message) {
    const time = new Date(message.timestamp).toLocaleTimeString();

    if (message.type === "system") {
      console.log(chalk.gray(`\n[${time}] ${message.content}`));
    } else {
      const name = chalk.bold(message.agentName);
      console.log(`\n[${time}] ${name}: ${message.content}`);
    }

    this.rl.prompt();
  }

  async sendMessage(content) {
    if (!content) return;

    try {
      await axios.post(`${SERVER_URL}/api/send`, {
        agentId: this.agentId,
        content,
        metadata: {},
      });
    } catch (error) {
      console.log(chalk.red(`Failed to send message: ${error.message}`));
    }
  }

  async listRooms() {
    try {
      const response = await axios.get(`${SERVER_URL}/api/rooms`);
      const rooms = response.data.rooms;

      console.log(chalk.yellow("\nActive rooms:"));
      if (rooms.length === 0) {
        console.log(chalk.gray("  No active rooms"));
      } else {
        rooms.forEach((room) => {
          const current = room.name === this.currentRoom ? " (current)" : "";
          console.log(
            `  ${chalk.bold(room.name)} - ${room.agentCount} agents${current}`
          );
        });
      }
    } catch (error) {
      console.log(chalk.red(`Failed to list rooms: ${error.message}`));
    }
  }

  async listAgents() {
    if (!this.currentRoom) {
      console.log(chalk.yellow("Not in a room"));
      return;
    }

    try {
      const response = await axios.get(
        `${SERVER_URL}/api/agents/${this.currentRoom}`
      );
      const agents = response.data.agents;

      console.log(chalk.yellow(`\nAgents in ${this.currentRoom}:`));
      agents.forEach((agent) => {
        const role = agent.capabilities?.role || "unknown";
        console.log(`  ${chalk.bold(agent.name)} (${role})`);
      });
    } catch (error) {
      console.log(chalk.red(`Failed to list agents: ${error.message}`));
    }
  }

  async showHistory(limitStr) {
    if (!this.currentRoom) {
      console.log(chalk.yellow("Not in a room"));
      return;
    }

    const limit = parseInt(limitStr) || 20;

    try {
      const response = await axios.get(
        `${SERVER_URL}/api/messages/${this.currentRoom}`,
        {
          params: { limit },
        }
      );

      const messages = response.data.messages;
      console.log(chalk.yellow(`\nLast ${messages.length} messages:`));

      messages.forEach((msg) => this.displayMessage(msg));
    } catch (error) {
      console.log(chalk.red(`Failed to get history: ${error.message}`));
    }
  }

  async handleTaskCommand(args) {
    if (!this.currentRoom) {
      console.log(chalk.yellow("Not in a room"));
      return;
    }

    const subcommand = args[0];

    switch (subcommand) {
      case "create":
        await this.createTask();
        break;

      case "list":
        await this.listTasks();
        break;

      case "update":
        await this.updateTask(args[1]);
        break;

      case "template":
        await this.handleTemplateCommand(args.slice(1));
        break;

      default:
        console.log(
          chalk.yellow(
            "Usage: /task create | /task list | /task update <id> | /task template <name>"
          )
        );
    }
  }

  async createTask() {
    const title = await this.question("Task title: ");
    const description = await this.question("Description: ");
    const priority =
      (await this.question("Priority (low/medium/high) [medium]: ")) ||
      "medium";
    const assignee = await this.question("Assign to (agent name, optional): ");

    try {
      const response = await axios.post(`${SERVER_URL}/api/tasks`, {
        roomName: this.currentRoom,
        title,
        description,
        priority,
        assignee: assignee || undefined,
        creator: this.agentName,
      });

      console.log(chalk.green("✓ Task created successfully"));
    } catch (error) {
      console.log(chalk.red(`Failed to create task: ${error.message}`));
    }
  }

  async listTasks() {
    try {
      const response = await axios.get(
        `${SERVER_URL}/api/tasks/${this.currentRoom}`
      );
      const tasks = response.data.tasks;

      console.log(chalk.yellow(`\nTasks in ${this.currentRoom}:`));
      if (tasks.length === 0) {
        console.log(chalk.gray("  No tasks"));
      } else {
        tasks.forEach((task) => {
          const status = task.status.toUpperCase();
          const assignee = task.assignee || "Unassigned";
          console.log(`  [${status}] ${chalk.bold(task.title)} - ${assignee}`);
        });
      }
    } catch (error) {
      console.log(chalk.red(`Failed to list tasks: ${error.message}`));
    }
  }

  async updateTask(taskId) {
    if (!this.currentRoom) {
      console.log(chalk.yellow("Not in a room"));
      return;
    }

    try {
      const response = await axios.get(
        `${SERVER_URL}/api/tasks/${this.currentRoom}/${taskId}`
      );
      const task = response.data.task;

      if (!task) {
        console.log(chalk.red("Task not found"));
        return;
      }

      const status = await this.question(
        "New status (open/in-progress/completed): "
      );
      const updatedTask = {
        ...task,
        status: status.toUpperCase(),
      };

      await axios.put(
        `${SERVER_URL}/api/tasks/${this.currentRoom}/${taskId}`,
        updatedTask
      );
      console.log(chalk.green("✓ Task status updated successfully"));
    } catch (error) {
      console.log(chalk.red(`Failed to update task: ${error.message}`));
    }
  }

  async showStats() {
    try {
      const response = await axios.get(`${SERVER_URL}/api/stats`);
      const stats = response.data;

      console.log(chalk.yellow("\n📊 System Statistics:"));
      console.log(`  Total Rooms: ${stats.totalRooms}`);
      console.log(`  Total Agents: ${stats.totalAgents}`);
      console.log(`  Total Tasks: ${stats.totalTasks}`);
      console.log(`  Shared Dir: ${stats.sharedDirectory}`);

      if (stats.rooms.length > 0) {
        console.log(chalk.yellow("\n📋 Room Details:"));
        stats.rooms.forEach((room) => {
          console.log(
            `  ${room.name}: ${room.agentCount} agents, ${room.messageCount} messages`
          );
        });
      }
    } catch (error) {
      console.log(chalk.red(`Failed to get stats: ${error.message}`));
    }
  }

  async broadcast(message) {
    if (!this.currentRoom) {
      console.log(chalk.yellow("Not in a room"));
      return;
    }

    if (!message) {
      console.log(chalk.red("Please provide a message to broadcast"));
      return;
    }

    try {
      await axios.post(`${SERVER_URL}/api/broadcast/${this.currentRoom}`, {
        content: message,
        from: this.agentName,
      });

      console.log(
        chalk.green(`📢 Broadcast sent to room "${this.currentRoom}"`)
      );
    } catch (error) {
      console.log(chalk.red(`Failed to broadcast: ${error.message}`));
    }
  }

  async assignTask(args) {
    if (!this.currentRoom) {
      console.log(chalk.yellow("Not in a room"));
      return;
    }

    const agentName = args[0];
    const taskDescription = args.slice(1).join(" ");

    if (!agentName || !taskDescription) {
      console.log(chalk.red("Usage: /assign <agent_name> <task_description>"));
      return;
    }

    try {
      const response = await axios.post(`${SERVER_URL}/api/tasks`, {
        roomName: this.currentRoom,
        title: `Assigned to ${agentName}`,
        description: taskDescription,
        assignee: agentName,
        creator: this.agentName,
        priority: "medium",
      });

      console.log(
        chalk.green(`✅ Task assigned to ${agentName}: "${taskDescription}"`)
      );
    } catch (error) {
      console.log(chalk.red(`Failed to assign task: ${error.message}`));
    }
  }

  async monitorMode(roomName) {
    const targetRoom = roomName || this.currentRoom;

    if (!targetRoom) {
      console.log(chalk.yellow("Please specify a room or join one first"));
      return;
    }

    console.log(
      chalk.blue(
        `👁️  Monitoring room "${targetRoom}"... (Press any key to stop)`
      )
    );

    // Simple monitoring - could be enhanced with real-time updates
    const interval = setInterval(async () => {
      try {
        const response = await axios.get(
          `${SERVER_URL}/api/messages/${targetRoom}`,
          {
            params: { limit: 1 },
          }
        );

        if (response.data.messages.length > 0) {
          const msg = response.data.messages[0];
          console.log(
            chalk.gray(
              `[${new Date(msg.timestamp).toLocaleTimeString()}] ${
                msg.agentName
              }: ${msg.content}`
            )
          );
        }
      } catch (error) {
        // Silent fail for monitoring
      }
    }, 2000);

    // Stop monitoring on any key press
    process.stdin.setRawMode(true);
    process.stdin.once("data", () => {
      clearInterval(interval);
      process.stdin.setRawMode(false);
      console.log(chalk.blue("\n👁️  Monitoring stopped"));
      this.rl.prompt();
    });
  }

  async tagAgent(args) {
    if (!this.currentRoom) {
      console.log(chalk.yellow("Not in a room"));
      return;
    }

    const agentName = args[0];
    const message = args.slice(1).join(" ");

    if (!agentName || !message) {
      console.log(chalk.red("Usage: /tag <agent_name> <message>"));
      return;
    }

    try {
      const response = await axios.post(`${SERVER_URL}/api/send`, {
        agentId: this.agentId,
        content: `@${agentName} ${message}`,
        metadata: { type: "direct_tag", target: agentName },
      });

      console.log(chalk.green(`🏷️  Tagged ${agentName}: "${message}"`));
    } catch (error) {
      console.log(chalk.red(`Failed to tag agent: ${error.message}`));
    }
  }

  async viewLogs(type = "all") {
    try {
      const response = await axios.get(`${SERVER_URL}/api/stats`);
      const stats = response.data;

      console.log(chalk.yellow(`\n📋 System Logs (${type}):`));
      console.log(
        `Total Messages: ${stats.rooms.reduce(
          (sum, room) => sum + room.messageCount,
          0
        )}`
      );
      console.log(`Active Agents: ${stats.totalAgents}`);
      console.log(`Total Tasks: ${stats.totalTasks}`);

      if (stats.rooms.length > 0) {
        console.log(chalk.yellow("\n📊 Activity by Room:"));
        stats.rooms.forEach((room) => {
          console.log(
            `  ${room.name}: ${room.messageCount} messages, ${room.agentCount} agents`
          );
        });
      }
    } catch (error) {
      console.log(chalk.red(`Failed to get logs: ${error.message}`));
    }
  }

  async manageMemory(args) {
    const action = args[0];

    if (action === "list") {
      try {
        const response = await axios.get(`${SERVER_URL}/api/stats`);
        console.log(chalk.yellow("\n🧠 Memory Usage Summary:"));
        console.log(`Rooms in memory: ${response.data.totalRooms}`);
        console.log(`Agents in memory: ${response.data.totalAgents}`);
        console.log(`Tasks in memory: ${response.data.totalTasks}`);
        console.log(
          `Data directory: ${response.data.sharedDirectory || "Not available"}`
        );
      } catch (error) {
        console.log(chalk.red(`Failed to get memory info: ${error.message}`));
      }
    } else {
      console.log(chalk.yellow("Usage: /memory list"));
    }
  }

  async viewNotifications(agentName) {
    if (!agentName && !this.currentRoom) {
      console.log(chalk.yellow("Please specify an agent name or join a room"));
      return;
    }

    try {
      // For orchestrator, show recent system events as "notifications"
      const response = await axios.get(
        `${SERVER_URL}/api/messages/${this.currentRoom || "system"}`,
        {
          params: { limit: 10 },
        }
      );

      const messages = response.data.messages.filter(
        (msg) => msg.type === "system" || msg.mentions?.length > 0
      );

      console.log(chalk.yellow("\n🔔 Recent Notifications & System Events:"));
      if (messages.length === 0) {
        console.log(chalk.gray("  No recent notifications"));
      } else {
        messages.forEach((msg) => {
          const time = new Date(msg.timestamp).toLocaleTimeString();
          const type = msg.mentions?.length > 0 ? "🏷️ " : "📢 ";
          console.log(`  ${type}[${time}] ${msg.content}`);
        });
      }
    } catch (error) {
      console.log(chalk.red(`Failed to get notifications: ${error.message}`));
    }
  }

  question(prompt) {
    return new Promise((resolve) => {
      this.rl.question(chalk.cyan(prompt), resolve);
    });
  }
}

// Start the orchestrator
const orchestrator = new OrchestratorCLI();
orchestrator.start();
