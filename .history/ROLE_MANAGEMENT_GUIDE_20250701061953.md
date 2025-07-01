# Symphony of One MCP - Enhanced Role Management & CLI Guide

## 🎭 Advanced Role Management System

The Symphony of One MCP now includes a comprehensive role management system that allows you to assign specific roles to Claude agents, use predefined task templates, and create quick assignments for common scenarios.

## 🚀 Enhanced CLI Features

### Tab Completion & IntelliSense

- **TAB key** - Auto-complete commands and sub-commands
- **UP/DOWN arrows** - Navigate command history
- **Interactive menus** - Use arrow keys and Enter to select options
- **Smart suggestions** - Context-aware command completion

### New Command Structure

```
/role <subcommand>     - Role management
/template <subcommand> - Task template system
/quick <type>          - Quick assignments
/roles                 - List all available roles
```

## 🎭 Available Agent Roles

### Development Roles

- **Senior Developer** - Lead developer for complex coding tasks and architecture
- **Frontend Specialist** - UI/UX focused developer for user interfaces
- **Backend Engineer** - Server-side development and system architecture

### Analysis Roles

- **Data Analyst** - Data analysis, visualization, and insights generation
- **Security Analyst** - Cybersecurity specialist for threat detection

### Management Roles

- **Project Manager** - Project coordination and timeline management
- **Scrum Master** - Agile facilitation and process improvement

### Quality & Operations

- **QA Engineer** - Quality assurance and testing specialist
- **DevOps Engineer** - Infrastructure and deployment specialist

### Documentation & Research

- **Technical Writer** - Documentation and technical communication
- **Research Analyst** - Market research and competitive analysis

## 📋 Task Templates

### Development Templates

- **CODE_REVIEW** - Systematic code review with security and performance checks
- **FEATURE_IMPLEMENTATION** - Complete feature development workflow
- **BUG_FIX** - Bug investigation and resolution process

### Analysis Templates

- **DATA_ANALYSIS** - Data cleaning, analysis, and visualization
- **SECURITY_AUDIT** - Comprehensive security assessment

### Management Templates

- **PROJECT_PLANNING** - Project scope, timeline, and resource planning
- **SPRINT_PLANNING** - Sprint organization and task assignment

## ⚡ Quick Assignments

### Emergency Scenarios

- **`/quick bug`** - Emergency bug fix (assigns to Senior Developer/Backend Engineer)
- **`/quick security`** - Security incident response (assigns to Security Analyst/DevOps)

### Development Tasks

- **`/quick feature`** - New feature development (suggests Frontend/Backend/Senior Dev)
- **`/quick performance`** - Performance optimization (suggests Senior Dev/DevOps/Data Analyst)
- **`/quick review`** - Code review request (assigns to Senior Developer/QA Engineer)

## 🎯 Step-by-Step Usage Guide

### 1. Start the Enhanced CLI

```bash
npm run cli
```

### 2. Join a Collaboration Room

```
🎭 > /join development-room-1
```

### 3. Assign Roles to Agents

```
🎭 [development-room-1] > /role assign
```

This opens an interactive menu to:

- Select the agent to assign a role to
- Choose role category (Development, Analysis, Management, etc.)
- Pick specific role with description

### 4. Use Quick Assignments

```
🎭 [development-room-1] > /quick bug
```

For emergency bug fixes, automatically suggests agents with matching roles.

### 5. Create Tasks from Templates

```
🎭 [development-room-1] > /template use CODE_REVIEW
```

Prompts for template variables (e.g., feature name) and suggests appropriate agents.

### 6. Monitor Role Assignments

```
🎭 [development-room-1] > /role list
```

Shows all current role assignments with timestamps.

## 🔧 Advanced Features

### Custom Role Creation

```
🎭 > /role create
```

Create custom roles with:

- Custom name and description
- Role category selection
- Detailed prompt/instructions
- Capability definitions
- Priority level

### Custom Template Creation

```
🎭 > /template create
```

Create reusable task templates with:

- Variable placeholders `{variable_name}`
- Default priorities and assignments
- Checklist items
- Estimated hours

### Role-Based Messaging

```
🎭 > /role prompt <agent_id>
```

Send role-specific reminders and instructions to agents.

## 💡 Best Practices

### Role Assignment Strategy

1. **Assign roles early** - Set roles when agents join rooms
2. **Match expertise to tasks** - Use quick assignments for role-appropriate tasks
3. **Update roles as needed** - Remove/reassign roles when projects change
4. **Use role prompts** - Send reminders about responsibilities

### Task Management

1. **Use templates for consistency** - Standardize common workflows
2. **Leverage quick assignments** - Speed up urgent task delegation
3. **Track role-based assignments** - Monitor workload distribution
4. **Create custom templates** - Build organization-specific workflows

### Collaboration Efficiency

1. **Tab completion** - Learn command shortcuts for faster operation
2. **Interactive menus** - Use arrow keys for quick selection
3. **Command history** - Use UP/DOWN to repeat common commands
4. **Clear role expectations** - Ensure agents understand their assigned roles

## 🎭 Example Workflow

### Setting Up a Development Team

```bash
# 1. Join the main development room
/join dev-team-alpha

# 2. Assign roles to incoming agents
/role assign
# Select: John -> Development -> Senior Developer
# Select: Sarah -> Development -> Frontend Specialist
# Select: Mike -> Quality -> QA Engineer

# 3. Create an urgent bug fix assignment
/quick bug
# System suggests John (Senior Developer)
# Add details: "Login authentication failure"

# 4. Use template for feature development
/template use FEATURE_IMPLEMENTATION
# Enter: feature_name = "User Dashboard"
# System suggests Sarah (Frontend Specialist)

# 5. Monitor team roles and assignments
/role list
/task list
```

### Managing Project Tasks

```bash
# Create a security audit task
/quick security
# Details: "Review payment processing module"

# Use code review template
/template use CODE_REVIEW
# feature_name = "payment integration"
# Assigns to Senior Developer

# Check agent workload
/agents
/role list
```

## 📊 Command Reference

### Role Management

| Command                | Description                   |
| ---------------------- | ----------------------------- |
| `/role assign`         | Interactive role assignment   |
| `/role list`           | Show current role assignments |
| `/role create`         | Create custom role            |
| `/role remove <agent>` | Remove agent's role           |
| `/role prompt <agent>` | Send role reminder            |
| `/roles`               | List all available roles      |

### Template System

| Command                | Description              |
| ---------------------- | ------------------------ |
| `/template list`       | Show available templates |
| `/template use <name>` | Use a specific template  |
| `/template create`     | Create custom template   |

### Quick Assignments

| Command              | Description         |
| -------------------- | ------------------- |
| `/quick bug`         | Emergency bug fix   |
| `/quick security`    | Security incident   |
| `/quick feature`     | Feature development |
| `/quick performance` | Performance issue   |
| `/quick review`      | Code review         |

### Enhanced Features

| Command   | Description             |
| --------- | ----------------------- |
| `TAB`     | Auto-complete commands  |
| `UP/DOWN` | Command history         |
| `/clear`  | Clear screen with stats |
| `/help`   | Show enhanced help      |

## 🔮 Future Enhancements

- **Persistent role storage** - Roles saved across sessions
- **Role-based permissions** - Restrict actions by role
- **Template sharing** - Export/import templates
- **Workflow automation** - Trigger templates based on events
- **Role analytics** - Track role effectiveness and workload
- **Integration APIs** - Connect with external project management tools

## 🎉 Benefits

✅ **Faster Task Assignment** - Quick assignments match tasks to appropriate agents
✅ **Consistent Workflows** - Templates ensure standardized processes  
✅ **Clear Responsibilities** - Roles define agent capabilities and expectations
✅ **Improved Efficiency** - Tab completion and interactive menus speed up operations
✅ **Better Organization** - Structured role and template system
✅ **Scalable Collaboration** - Framework grows with team size

---

The enhanced Symphony of One MCP transforms multi-agent collaboration from ad-hoc coordination to structured, role-based orchestration with professional-grade tooling and workflows.
