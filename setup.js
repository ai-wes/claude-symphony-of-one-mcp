#!/usr/bin/env node
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('🎭 Setting up Symphony of One MCP...\n');

// Check if we need to install dependencies
async function checkAndInstallDependencies() {
  try {
    await fs.access(path.join(__dirname, 'node_modules'));
    console.log('✓ Dependencies already installed');
    return true;
  } catch {
    console.log('📦 Installing dependencies...');
    
    return new Promise((resolve, reject) => {
      const npm = spawn('npm', ['install'], { 
        cwd: __dirname,
        stdio: 'inherit',
        shell: true 
      });
      
      npm.on('close', (code) => {
        if (code === 0) {
          console.log('✓ Dependencies installed successfully');
          resolve(true);
        } else {
          console.error('❌ Failed to install dependencies');
          reject(new Error(`npm install failed with code ${code}`));
        }
      });
    });
  }
}

// Create shared directory
async function createSharedDirectory() {
  const sharedDir = path.join(__dirname, 'shared');
  try {
    await fs.access(sharedDir);
    console.log('✓ Shared directory already exists');
  } catch {
    await fs.mkdir(sharedDir, { recursive: true });
    console.log('✓ Created shared directory');
    
    // Create a welcome file
    await fs.writeFile(
      path.join(sharedDir, 'welcome.md'),
      '# Welcome to Symphony of One MCP\n\nThis is the shared workspace for agent collaboration.\n\nAgents can read and write files here to coordinate their work.\n'
    );
    console.log('✓ Created welcome.md file');
  }
}

// Test MCP server
async function testMCPServer() {
  console.log('\n🧪 Testing MCP server...');
  
  return new Promise((resolve) => {
    const server = spawn('node', ['mcp-server.js'], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true
    });
    
    let output = '';
    let hasStarted = false;
    
    server.stderr.on('data', (data) => {
      output += data.toString();
      if (output.includes('MCP Server connected and ready')) {
        hasStarted = true;
        server.kill();
      }
    });
    
    server.on('close', () => {
      if (hasStarted) {
        console.log('✅ MCP server test successful');
      } else {
        console.log('❌ MCP server test failed');
        console.log('Output:', output);
      }
      resolve(hasStarted);
    });
    
    // Send a simple initialization test
    setTimeout(() => {
      if (!hasStarted) {
        server.kill();
      }
    }, 5000);
  });
}

// Print configuration instructions
function printConfigurationInstructions() {
  console.log('\n📋 Configuration Instructions:');
  console.log('━'.repeat(50));
  console.log('\n1. Add this to your Claude Desktop configuration:');
  console.log('   (Usually located at: %APPDATA%\\Claude\\claude_desktop_config.json)\n');
  
  const configPath = path.join(__dirname, 'mcp-server.js').replace(/\\/g, '\\\\');
  const sharedPath = path.join(__dirname, 'shared').replace(/\\/g, '\\\\');
  
  console.log('```json');
  console.log('{');
  console.log('  "mcpServers": {');
  console.log('    "claude-symphony-of-one": {');
  console.log('      "command": "node",');
  console.log(`      "args": ["${configPath}"],`);
  console.log('      "env": {');
  console.log('        "CHAT_SERVER_URL": "http://localhost:3000",');
  console.log(`        "SHARED_DIR": "${sharedPath}",`);
  console.log('        "AGENT_NAME": "Claude-Agent-1"');
  console.log('      }');
  console.log('    }');
  console.log('  }');
  console.log('}');
  console.log('```\n');
  
  console.log('2. Start the hub server in a separate terminal:');
  console.log('   npm run server\n');
  
  console.log('3. Start the orchestrator CLI (optional):');
  console.log('   npm run cli\n');
  
  console.log('4. Restart Claude Desktop to load the MCP server\n');
  
  console.log('5. Available tools in Claude:');
  console.log('   • room_join - Join collaboration rooms');
  console.log('   • send_message - Chat with other agents');
  console.log('   • get_messages - Read chat history');
  console.log('   • create_task / get_tasks - Task management');
  console.log('   • memory_store / memory_retrieve - Persistent memory');
  console.log('   • file_read / file_write / file_list - Shared workspace');
  console.log('   • get_notifications - Check mentions and alerts\n');
  
  console.log('🎭 Symphony of One MCP setup complete!');
  console.log('   Ready for multi-agent collaboration! 🤖🤖🤖');
}

// Main setup function
async function main() {
  try {
    await checkAndInstallDependencies();
    await createSharedDirectory();
    
    const testPassed = await testMCPServer();
    
    if (testPassed) {
      printConfigurationInstructions();
    } else {
      console.log('\n❌ Setup completed with warnings');
      console.log('   The MCP server may have issues. Check the logs above.');
      printConfigurationInstructions();
    }
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    process.exit(1);
  }
}

main();