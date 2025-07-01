#!/usr/bin/env node
import readline from 'readline';
import axios from 'axios';
import { io } from 'socket.io-client';
import chalk from 'chalk';
import { v4 as uuidv4 } from 'uuid';

const SERVER_URL = process.env.CHAT_SERVER_URL || 'http://localhost:3000';

class OrchestratorCLI {
  constructor() {
    this.socket = null;
    this.currentRoom = null;
    this.agentId = `orchestrator-${uuidv4()}`;
    this.agentName = 'Orchestrator';
    this.isOrchestrator = true;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan('🎭 > ')
    });
  }

  async start() {
    console.log(chalk.green(`\n🎭 Symphony of One MCP Orchestrator`));
    console.log(chalk.gray(`   Hub Server: ${SERVER_URL}`));
    console.log(chalk.yellow(`   Role: User/Orchestrator\n`));
    
    await this.setupHandlers();
    await this.showStats();
    this.showHelp();
    this.rl.prompt();
  }

  async setupHandlers() {
    this.rl.on('line', async (line) => {
      const input = line.trim();
      
      if (input.startsWith('/')) {
        await this.handleCommand(input);
      } else if (this.currentRoom) {
        await this.sendMessage(input);
      } else {
        console.log(chalk.yellow('Not in a room. Use /join <room> to join a room.'));
      }
      
      this.rl.prompt();
    });

    this.rl.on('close', () => {
      if (this.socket) this.socket.disconnect();
      console.log(chalk.gray('\nGoodbye!'));
      process.exit(0);
    });
  }

  async handleCommand(input) {
    const [command, ...args] = input.split(' ');
    
    switch (command) {
      case '/help':
      case '/h':
        this.showHelp();
        break;
        
      case '/join':
      case '/j':
        await this.joinRoom(args[0]);
        break;
        
      case '/leave':
      case '/l':
        await this.leaveRoom();
        break;
        
      case '/rooms':
      case '/r':
        await this.listRooms();
        break;
        
      case '/agents':
      case '/a':
        await this.listAgents();
        break;
        
      case '/history':
      case '/hist':
        await this.showHistory(args[0]);
        break;
        
      case '/task':
        await this.handleTaskCommand(args);
        break;
        
      case '/broadcast':
      case '/bc':
        await this.broadcast(args.join(' '));
        break;
        
      case '/stats':
      case '/st':
        await this.showStats();
        break;
        
      case '/assign':
        await this.assignTask(args);
        break;
        
      case '/monitor':
      case '/mon':
        await this.monitorMode(args[0]);
        break;
        
      case '/tag':
        await this.tagAgent(args);
        break;
        
      case '/logs':
        await this.viewLogs(args[0]);
        break;
        
      case '/memory':
      case '/mem':
        await this.manageMemory(args);
        break;
        
      case '/notifications':
      case '/notif':
        await this.viewNotifications(args[0]);
        break;
        
      case '/name':
        this.agentName = args.join(' ') || 'Orchestrator';
        console.log(chalk.green(`Name set to: ${this.agentName}`));
        break;
        
      case '/clear':
        console.clear();
        break;
        
      case '/quit':
      case '/q':
        this.rl.close();
        break;
        
      default:
        console.log(chalk.red(`Unknown command: ${command}`));
        this.showHelp();
    }
  }

  showHelp() {
    console.log(chalk.yellow('\n🎭 Orchestrator Commands:'));
    console.log(chalk.cyan('Room Management:'));
    console.log('  /join <room>        - Join a chat room');
    console.log('  /leave              - Leave current room');
    console.log('  /rooms              - List all rooms');
    console.log('  /agents             - List agents in current room');
    console.log('  /history [n]        - Show last n messages');
    
    console.log(chalk.cyan('\nAgent Orchestration:'));
    console.log('  /broadcast <msg>    - Send message to all agents in room');
    console.log('  /assign <task>      - Assign task to specific agent');
    console.log('  /tag <agent> <msg>  - Send tagged message to specific agent');
    console.log('  /monitor [room]     - Monitor room activity');
    console.log('  /stats              - Show system statistics');
    
    console.log(chalk.cyan('\nTask Management:'));
    console.log('  /task create        - Create a new task');
    console.log('  /task list          - List room tasks');
    console.log('  /task update <id>   - Update task status');
    
    console.log(chalk.cyan('\nMemory & Notifications:'));
    console.log('  /memory list        - View system memory logs');
    console.log('  /notifications      - View recent notifications');
    console.log('  /logs [type]        - View system logs');
    
    console.log(chalk.cyan('\nSystem:'));
    console.log('  /name <name>        - Set your display name');
    console.log('  /clear              - Clear screen');
    console.log('  /help               - Show this help');
    console.log('  /quit               - Exit\n');
  }

  async joinRoom(roomName) {
    if (!roomName) {
      console.log(chalk.red('Please specify a room name'));
      return;
    }

    try {
      const response = await axios.post(`${SERVER_URL}/api/join/${roomName}`, {
        agentId: this.agentId,
        agentName: this.agentName,
        capabilities: { 
          role: 'orchestrator', 
          type: 'human',
          permissions: ['broadcast', 'assign_tasks', 'monitor'] 
        }
      });

      if (response.data.success) {
        this.currentRoom = roomName;
        this.connectSocket();
        
        console.log(chalk.green(`\n✓ Joined room: ${roomName}`));
        console.log(chalk.gray(`  ${response.data.currentAgents.length} agents in room\n`));
        
        // Update prompt
        this.rl.setPrompt(chalk.cyan(`🎭 [${roomName}] > `));
      }
    } catch (error) {
      console.log(chalk.red(`Failed to join room: ${error.message}`));
    }
  }

  async leaveRoom() {
    if (!this.currentRoom) {
      console.log(chalk.yellow('Not in a room'));
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
      this.rl.setPrompt(chalk.cyan('🎭 > '));
    } catch (error) {
      console.log(chalk.red(`Failed to leave room: ${error.message}`));
    }
  }

  connectSocket() {
    if (this.socket) this.socket.disconnect();
    
    this.socket = io(SERVER_URL);
    
    this.socket.on('connect', () => {
      this.socket.emit('register', { 
        agentId: this.agentId, 
        room: this.currentRoom 
      });
    });
    
    this.socket.on('message', (message) => {
      // Don't show our own messages again
      if (message.agentId !== this.agentId) {
        this.displayMessage(message);
      }
    });
    
    this.socket.on('task', (data) => {
      console.log(chalk.magenta(`\n[Task ${data.type}] ${data.task.title}`));
      this.rl.prompt();
    });
  }

  displayMessage(message) {
    const time = new Date(message.timestamp).toLocaleTimeString();
    
    if (message.type === 'system') {
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
        metadata: {}
      });
    } catch (error) {
      console.log(chalk.red(`Failed to send message: ${error.message}`));
    }
  }

  async listRooms() {
    try {
      const response = await axios.get(`${SERVER_URL}/api/rooms`);
      const rooms = response.data.rooms;
      
      console.log(chalk.yellow('\nActive rooms:'));
      if (rooms.length === 0) {
        console.log(chalk.gray('  No active rooms'));
      } else {
        rooms.forEach(room => {
          const current = room.name === this.currentRoom ? ' (current)' : '';
          console.log(`  ${chalk.bold(room.name)} - ${room.agentCount} agents${current}`);
        });
      }
    } catch (error) {
      console.log(chalk.red(`Failed to list rooms: ${error.message}`));
    }
  }

  async listAgents() {
    if (!this.currentRoom) {
      console.log(chalk.yellow('Not in a room'));
      return;
    }

    try {
      const response = await axios.get(`${SERVER_URL}/api/agents/${this.currentRoom}`);
      const agents = response.data.agents;
      
      console.log(chalk.yellow(`\nAgents in ${this.currentRoom}:`));
      agents.forEach(agent => {
        const role = agent.capabilities?.role || 'unknown';
        console.log(`  ${chalk.bold(agent.name)} (${role})`);
      });
    } catch (error) {
      console.log(chalk.red(`Failed to list agents: ${error.message}`));
    }
  }

  async showHistory(limitStr) {
    if (!this.currentRoom) {
      console.log(chalk.yellow('Not in a room'));
      return;
    }

    const limit = parseInt(limitStr) || 20;

    try {
      const response = await axios.get(`${SERVER_URL}/api/messages/${this.currentRoom}`, {
        params: { limit }
      });
      
      const messages = response.data.messages;
      console.log(chalk.yellow(`\nLast ${messages.length} messages:`));
      
      messages.forEach(msg => this.displayMessage(msg));
    } catch (error) {
      console.log(chalk.red(`Failed to get history: ${error.message}`));
    }
  }

  async handleTaskCommand(args) {
    if (!this.currentRoom) {
      console.log(chalk.yellow('Not in a room'));
      return;
    }

    const subcommand = args[0];
    
    switch (subcommand) {
      case 'create':
        await this.createTask();
        break;
        
      case 'list':
        await this.listTasks();
        break;
        
      default:
        console.log(chalk.yellow('Usage: /task create | /task list'));
    }
  }

  async createTask() {
    const title = await this.question('Task title: ');
    const description = await this.question('Description: ');
    const priority = await this.question('Priority (low/medium/high) [medium]: ') || 'medium';
    const assignee = await this.question('Assign to (agent name, optional): ');

    try {
      const response = await axios.post(`${SERVER_URL}/api/tasks`, {
        roomName: this.currentRoom,
        title,
        description,
        priority,
        assignee: assignee || undefined,
        creator: this.agentName
      });

      console.log(chalk.green('✓ Task created successfully'));
    } catch (error) {
      console.log(chalk.red(`Failed to create task: ${error.message}`));
    }
  }

  async listTasks() {
    try {
      const response = await axios.get(`${SERVER_URL}/api/tasks/${this.currentRoom}`);
      const tasks = response.data.tasks;
      
      console.log(chalk.yellow(`\nTasks in ${this.currentRoom}:`));
      if (tasks.length === 0) {
        console.log(chalk.gray('  No tasks'));
      } else {
        tasks.forEach(task => {
          const status = task.status.toUpperCase();
          const assignee = task.assignee || 'Unassigned';
          console.log(`  [${status}] ${chalk.bold(task.title)} - ${assignee}`);
        });
      }
    } catch (error) {
      console.log(chalk.red(`Failed to list tasks: ${error.message}`));
    }
  }

  // New orchestrator methods
  async showStats() {
    try {
      const response = await axios.get(`${SERVER_URL}/api/stats`);
      const stats = response.data;
      
      console.log(chalk.yellow('\n📊 System Statistics:'));
      console.log(`  Total Rooms: ${stats.totalRooms}`);
      console.log(`  Total Agents: ${stats.totalAgents}`);
      console.log(`  Total Tasks: ${stats.totalTasks}`);
      console.log(`  Shared Dir: ${stats.sharedDirectory}`);
      
      if (stats.rooms.length > 0) {
        console.log(chalk.yellow('\n📋 Room Details:'));
        stats.rooms.forEach(room => {
          console.log(`  ${room.name}: ${room.agentCount} agents, ${room.messageCount} messages`);
        });
      }
    } catch (error) {
      console.log(chalk.red(`Failed to get stats: ${error.message}`));
    }
  }

  async broadcast(message) {
    if (!this.currentRoom) {
      console.log(chalk.yellow('Not in a room'));
      return;
    }

    if (!message) {
      console.log(chalk.red('Please provide a message to broadcast'));
      return;
    }

    try {
      await axios.post(`${SERVER_URL}/api/broadcast/${this.currentRoom}`, {
        content: message,
        from: this.agentName
      });
      
      console.log(chalk.green(`📢 Broadcast sent to room "${this.currentRoom}"`));
    } catch (error) {
      console.log(chalk.red(`Failed to broadcast: ${error.message}`));
    }
  }

  async assignTask(args) {
    if (!this.currentRoom) {
      console.log(chalk.yellow('Not in a room'));
      return;
    }

    const agentName = args[0];
    const taskDescription = args.slice(1).join(' ');

    if (!agentName || !taskDescription) {
      console.log(chalk.red('Usage: /assign <agent_name> <task_description>'));
      return;
    }

    try {
      const response = await axios.post(`${SERVER_URL}/api/tasks`, {
        roomName: this.currentRoom,
        title: `Assigned to ${agentName}`,
        description: taskDescription,
        assignee: agentName,
        creator: this.agentName,
        priority: 'medium'
      });

      console.log(chalk.green(`✅ Task assigned to ${agentName}: "${taskDescription}"`));
    } catch (error) {
      console.log(chalk.red(`Failed to assign task: ${error.message}`));
    }
  }

  async monitorMode(roomName) {
    const targetRoom = roomName || this.currentRoom;
    
    if (!targetRoom) {
      console.log(chalk.yellow('Please specify a room or join one first'));
      return;
    }

    console.log(chalk.blue(`👁️  Monitoring room "${targetRoom}"... (Press any key to stop)`));
    
    // Simple monitoring - could be enhanced with real-time updates
    const interval = setInterval(async () => {
      try {
        const response = await axios.get(`${SERVER_URL}/api/messages/${targetRoom}`, {
          params: { limit: 1 }
        });
        
        if (response.data.messages.length > 0) {
          const msg = response.data.messages[0];
          console.log(chalk.gray(`[${new Date(msg.timestamp).toLocaleTimeString()}] ${msg.agentName}: ${msg.content}`));
        }
      } catch (error) {
        // Silent fail for monitoring
      }
    }, 2000);

    // Stop monitoring on any key press
    process.stdin.setRawMode(true);
    process.stdin.once('data', () => {
      clearInterval(interval);
      process.stdin.setRawMode(false);
      console.log(chalk.blue('\n👁️  Monitoring stopped'));
      this.rl.prompt();
    });
  }

  async tagAgent(args) {
    if (!this.currentRoom) {
      console.log(chalk.yellow('Not in a room'));
      return;
    }

    const agentName = args[0];
    const message = args.slice(1).join(' ');

    if (!agentName || !message) {
      console.log(chalk.red('Usage: /tag <agent_name> <message>'));
      return;
    }

    try {
      const response = await axios.post(`${SERVER_URL}/api/send`, {
        agentId: this.agentId,
        content: `@${agentName} ${message}`,
        metadata: { type: 'direct_tag', target: agentName }
      });

      console.log(chalk.green(`🏷️  Tagged ${agentName}: "${message}"`));
    } catch (error) {
      console.log(chalk.red(`Failed to tag agent: ${error.message}`));
    }
  }

  async viewLogs(type = 'all') {
    try {
      const response = await axios.get(`${SERVER_URL}/api/stats`);
      const stats = response.data;
      
      console.log(chalk.yellow(`\n📋 System Logs (${type}):`));
      console.log(`Total Messages: ${stats.rooms.reduce((sum, room) => sum + room.messageCount, 0)}`);
      console.log(`Active Agents: ${stats.totalAgents}`);
      console.log(`Total Tasks: ${stats.totalTasks}`);
      
      if (stats.rooms.length > 0) {
        console.log(chalk.yellow('\n📊 Activity by Room:'));
        stats.rooms.forEach(room => {
          console.log(`  ${room.name}: ${room.messageCount} messages, ${room.agentCount} agents`);
        });
      }
    } catch (error) {
      console.log(chalk.red(`Failed to get logs: ${error.message}`));
    }
  }

  async manageMemory(args) {
    const action = args[0];
    
    if (action === 'list') {
      try {
        const response = await axios.get(`${SERVER_URL}/api/stats`);
        console.log(chalk.yellow('\n🧠 Memory Usage Summary:'));
        console.log(`Rooms in memory: ${response.data.totalRooms}`);
        console.log(`Agents in memory: ${response.data.totalAgents}`);
        console.log(`Tasks in memory: ${response.data.totalTasks}`);
        console.log(`Data directory: ${response.data.sharedDirectory || 'Not available'}`);
      } catch (error) {
        console.log(chalk.red(`Failed to get memory info: ${error.message}`));
      }
    } else {
      console.log(chalk.yellow('Usage: /memory list'));
    }
  }

  async viewNotifications(agentName) {
    if (!agentName && !this.currentRoom) {
      console.log(chalk.yellow('Please specify an agent name or join a room'));
      return;
    }

    try {
      // For orchestrator, show recent system events as "notifications"
      const response = await axios.get(`${SERVER_URL}/api/messages/${this.currentRoom || 'system'}`, {
        params: { limit: 10 }
      });
      
      const messages = response.data.messages.filter(msg => 
        msg.type === 'system' || msg.mentions?.length > 0
      );
      
      console.log(chalk.yellow('\n🔔 Recent Notifications & System Events:'));
      if (messages.length === 0) {
        console.log(chalk.gray('  No recent notifications'));
      } else {
        messages.forEach(msg => {
          const time = new Date(msg.timestamp).toLocaleTimeString();
          const type = msg.mentions?.length > 0 ? '🏷️ ' : '📢 ';
          console.log(`  ${type}[${time}] ${msg.content}`);
        });
      }
    } catch (error) {
      console.log(chalk.red(`Failed to get notifications: ${error.message}`));
    }
  }

  question(prompt) {
    return new Promise(resolve => {
      this.rl.question(chalk.cyan(prompt), resolve);
    });
  }
}

// Start the orchestrator
const orchestrator = new OrchestratorCLI();
orchestrator.start();