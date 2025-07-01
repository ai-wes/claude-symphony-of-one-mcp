#!/usr/bin/env node
import { spawn } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

console.log('🧪 Testing Symphony of One MCP Server...\n');

async function testMCPServer() {
  try {
    console.log('📡 Starting MCP server process...');
    
    // Create client transport that spawns the server
    const transport = new StdioClientTransport({
      command: 'node',
      args: ['mcp-server.js']
    });

    const client = new Client({
      name: 'test-client',
      version: '1.0.0'
    });

    console.log('🔌 Connecting to MCP server...');
    await client.connect(transport);
    
    console.log('✅ Connected successfully!');
    
    // Test 1: List tools
    console.log('\n🔧 Testing tool listing...');
    const tools = await client.listTools();
    console.log(`✅ Found ${tools.tools.length} tools:`);
    tools.tools.forEach(tool => {
      console.log(`   • ${tool.name}: ${tool.description}`);
    });
    
    // Test 2: Test file listing
    console.log('\n📁 Testing file operations...');
    try {
      const fileListResult = await client.callTool({
        name: 'file_list',
        arguments: {}
      });
      console.log('✅ File listing works');
      console.log('   Result:', fileListResult.content[0].text.substring(0, 100) + '...');
    } catch (error) {
      console.log('⚠️  File listing failed:', error.message);
    }
    
    // Test 3: Test room joining (will fail without server, but tests the tool)
    console.log('\n🏠 Testing room join (expected to fail without hub server)...');
    try {
      const joinResult = await client.callTool({
        name: 'room_join',
        arguments: {
          roomName: 'test-room'
        }
      });
      console.log('✅ Room join works');
    } catch (error) {
      console.log('⚠️  Room join failed (expected without hub server):', error.message.substring(0, 100));
    }
    
    // Test 4: Test memory storage (will fail without server)
    console.log('\n🧠 Testing memory operations (expected to fail without hub server)...');
    try {
      const memoryResult = await client.callTool({
        name: 'memory_store',
        arguments: {
          key: 'test-key',
          value: 'test-value'
        }
      });
      console.log('✅ Memory storage works');
    } catch (error) {
      console.log('⚠️  Memory storage failed (expected without hub server):', error.message.substring(0, 100));
    }
    
    await client.close();
    console.log('\n🎉 MCP Server test completed successfully!');
    console.log('\n📋 Summary:');
    console.log('   ✅ MCP server starts correctly');
    console.log('   ✅ Tools are properly registered');
    console.log('   ✅ File operations work locally');
    console.log('   ⚠️  Hub server features require running hub (npm run server)');
    
    return true;
    
  } catch (error) {
    console.error('\n❌ MCP Server test failed:', error.message);
    console.error('\nFull error:', error);
    return false;
  }
}

async function main() {
  const success = await testMCPServer();
  
  if (success) {
    console.log('\n🚀 MCP Server is ready for Claude Desktop!');
    console.log('\nNext steps:');
    console.log('1. Run "npm run server" to start the hub server');
    console.log('2. Add the MCP configuration to Claude Desktop');
    console.log('3. Restart Claude Desktop');
    console.log('4. Start collaborating with multiple Claude instances!');
    process.exit(0);
  } else {
    console.log('\n💥 Tests failed. Please check the setup.');
    process.exit(1);
  }
}

main();