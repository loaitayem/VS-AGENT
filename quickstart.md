# Quick Start Guide

Get up and running with AI Code Agent in 5 minutes!

## 🚀 Installation

1. **Install from VS Code Marketplace**
   - Open VS Code
   - Press `Ctrl/Cmd + Shift + X` to open Extensions
   - Search for "AI Code Agent"
   - Click Install

## 🔑 Setup (2 minutes)

### Step 1: Add Your Anthropic API Key
```
1. Press Ctrl/Cmd + Shift + P
2. Type "AI Agent: Set API Key"
3. Enter your key (starts with sk-ant-)
```

Don't have a key? Get one at [console.anthropic.com](https://console.anthropic.com)

### Step 2: Install Ollama (Optional but Recommended)
```bash
# macOS/Linux
curl -fsSL https://ollama.ai/install.sh | sh

# Windows
# Download from https://ollama.ai/download

# Pull a model
ollama pull llama3
```

## 💬 Your First Task

### Method 1: Quick Command
```
1. Press Ctrl/Cmd + Shift + P
2. Type "AI Agent: Execute Task"
3. Enter: "Add comments to all functions in this file"
4. Review and approve changes
```

### Method 2: Chat Interface
```
1. Click the AI Agent icon in the sidebar (robot icon)
2. Type your request in the chat
3. Click "Execute Task" or press Ctrl/Cmd + Enter
```

## 📝 Example Tasks to Try

### Beginner Tasks
```
"Add JSDoc comments to all exported functions"
"Convert var to const/let in all JavaScript files"
"Fix all ESLint errors in the current file"
```

### Intermediate Tasks
```
"Refactor this class to use async/await instead of callbacks"
"Add error handling to all API calls in services/"
"Create unit tests for the UserService class"
```

### Advanced Tasks
```
"Refactor the authentication module to use JWT tokens instead of sessions, update all related files"
"Optimize database queries in the models folder by adding proper indexes and using joins"
"Convert this React class component to functional component with hooks, preserve all functionality"
```

## ⚡ Quick Tips

### 1. Be Specific
❌ "Fix the code"
✅ "Fix the TypeScript errors in src/utils/validation.ts"

### 2. Use File Patterns
```
"Add try-catch blocks to all async functions in **/*.service.ts"
"Convert arrow functions to regular functions in src/components/**"
```

### 3. Preview First
- Always review the changes before applying
- Use `Ctrl/Cmd + Z` to undo if needed

### 4. Cost Saving
- The extension uses free models for indexing
- Only complex reasoning uses Claude API
- Check token usage in the status bar

## 🎯 Common Workflows

### Refactoring Workflow
```
1. "Analyze code smells in src/services/"
2. Review the analysis
3. "Refactor the identified issues, maintain all tests passing"
4. Run tests to verify
```

### Testing Workflow
```
1. "Generate unit tests for uncovered functions in utils/"
2. Review generated tests
3. "Add edge case tests for error scenarios"
4. Run coverage report
```

### Documentation Workflow
```
1. "Add JSDoc comments to all public APIs"
2. "Generate README.md from the codebase structure"
3. "Create examples for each exported function"
```

## 🛡️ Safety Features

- **Auto-backup**: Files are backed up before changes
- **Preview Mode**: See all changes before applying
- **Rollback**: Undo entire operations with one command
- **Git Integration**: Works great with version control

## ⌨️ Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Open AI Agent | `Ctrl/Cmd + Shift + A` |
| Execute Task | `Ctrl/Cmd + Enter` (in chat) |
| Cancel Operation | `Esc` |
| Toggle Prompt Assistant | `Ctrl/Cmd + L` (in chat) |

## 🔧 Quick Settings

Access settings: `Ctrl/Cmd + ,` then search "AI Code Agent"

**Essential Settings:**
- `ai-code-agent.model`: Choose between Opus 4 (powerful) or Sonnet 4 (faster)
- `ai-code-agent.maxFilesPerOperation`: Limit files modified at once
- `ai-code-agent.requireApproval`: Always preview changes (recommended ON)

## 📊 Monitor Usage

Check the status bar for:
- Current model
- Token count
- Estimated cost
- Processing status

## 🆘 Troubleshooting

### "API Key Invalid"
- Check for extra spaces in your key
- Ensure key starts with `sk-ant-`
- Try setting it again

### "Ollama Connection Failed"
```bash
# Check if Ollama is running
ollama list

# Start Ollama service
ollama serve
```

### "Out of Memory"
- Reduce `maxTokensPerRequest` in settings
- Close other VS Code windows
- Process fewer files at once

### "Changes Not Applying"
- Check if files are saved
- Ensure no syntax errors
- Try with a single file first

## 🎓 Next Steps

1. **Explore Templates**: Use the prompt assistant for common patterns
2. **View History**: Check past sessions in the history panel
3. **Customize**: Adjust settings for your workflow
4. **Learn More**: Read the full [README](README.md)

## 💡 Pro Tips

1. **Batch Similar Tasks**: "Fix all TypeScript errors AND add missing types"
2. **Use Context**: Reference specific patterns: "like the one in auth.service.ts"
3. **Iterate**: Start simple, then refine: "Now add error handling to those functions"
4. **Save Templates**: Good prompts can be reused across projects

---

**Need Help?** 
- Type "help" in the chat
- Check [Documentation](https://github.com/...)
- Report issues on GitHub

**Ready to code smarter? Start with a simple task and see the magic! ✨**