# AI Code Agent - VS Code Extension

A professional-grade VS Code extension that brings AI agent capabilities to your development workflow, powered by Claude Opus 4/Sonnet 4 and free preprocessor models.

## Features

### 🤖 Agent Mode Capabilities
- **Multi-step Planning**: Analyzes tasks and creates execution plans
- **Multi-file Editing**: Modifies multiple files with smart context awareness
- **Intelligent Context Management**: Chunks and retrieves relevant code sections
- **Safe Execution**: Preview changes before applying, with rollback support

### 🧠 Dual Model Architecture
- **Claude Opus 4/Sonnet 4**: For complex reasoning and code generation
- **Free Preprocessor Models**: For indexing, ranking, and context preparation
  - Llama 3 (via Ollama)
  - Google Gemini 1.5 Pro
  - Code Llama
  - Custom Ollama models

### 💡 Prompt Assistant
- Real-time prompt analysis and suggestions
- Template library for common tasks
- Complexity estimation and model recommendations
- One-click prompt improvements

### 📊 Advanced Features
- **Workspace Indexing**: Smart code indexing with symbol extraction
- **Session Management**: Track tasks, token usage, and costs
- **Diff Preview**: Review all changes before applying
- **Progress Tracking**: Real-time task progress visualization
- **Cost Awareness**: Token and cost tracking per operation

## Installation

1. Install the extension from VS Code Marketplace (once published)
2. Or build from source:
   ```bash
   git clone <repository>
   cd ai-code-agent
   npm install
   npm run compile
   ```

## Setup

### 1. Configure Anthropic API Key
1. Open Command Palette (`Ctrl/Cmd + Shift + P`)
2. Run `AI Agent: Set Anthropic API Key`
3. Enter your API key (starts with `sk-ant-`)

### 2. Set Up Preprocessor Model

#### Option A: Ollama (Recommended for local processing)
1. Install Ollama: https://ollama.ai
2. Pull a model:
   ```bash
   ollama pull llama3
   # or
   ollama pull codellama
   ```
3. Extension will auto-detect Ollama on localhost:11434

#### Option B: Google Gemini 1.5 Pro
1. Get API key from Google AI Studio
2. Run `AI Agent: Configure Preprocessor Model`
3. Select "Google Gemini 1.5 Pro"
4. Enter your API key

### 3. Index Your Workspace
- Automatic: Happens on extension activation
- Manual: Run `AI Agent: Index Workspace`

## Usage

### Basic Task Execution
1. Click the AI Agent icon in the activity bar
2. Type your task (e.g., "Refactor all promises to async/await")
3. Click "Execute Task" or press `Ctrl/Cmd + Enter`
4. Review the plan and approve changes

### Using the Prompt Assistant
1. Start typing a task
2. Click the lightbulb icon for suggestions
3. Apply suggested improvements
4. Use templates for common patterns

### Example Tasks

```
// Simple refactoring
"Convert all var declarations to const/let in src/"

// Complex refactoring with constraints
"Refactor the authentication module to use async/await instead of promises. 
Ensure error handling is preserved and add proper TypeScript types."

// Multi-file operations
"Add comprehensive unit tests for all service classes using Jest. 
Include edge cases and mock external dependencies."

// Performance optimization
"Analyze and optimize the data processing pipeline for better performance. 
Focus on reducing memory usage and execution time."
```

### Command Palette Commands

- `AI Agent: Start Chat` - Open the agent chat interface
- `AI Agent: Set Anthropic API Key` - Configure your API key
- `AI Agent: Select Model` - Choose between Opus 4 and Sonnet 4
- `AI Agent: Index Workspace` - Manually index workspace files
- `AI Agent: Show Session History` - View past sessions and tasks
- `AI Agent: Configure Preprocessor Model` - Set up free model
- `AI Agent: Execute Task` - Run a task directly

### Keyboard Shortcuts

- `Ctrl/Cmd + Shift + A`: Open AI Agent chat
- `Ctrl/Cmd + Enter`: Execute task (in chat)
- `Esc`: Cancel current operation

## Configuration

Access settings through VS Code Settings or `AI Agent: Settings`:

```json
{
  // Model Configuration
  "ai-code-agent.model": "claude-opus-4",
  "ai-code-agent.mode": "thinking",
  "ai-code-agent.maxTokensPerRequest": 100000,
  
  // Preprocessor Configuration
  "ai-code-agent.preprocessorModel": "llama3",
  "ai-code-agent.enablePromptAssistant": true,
  
  // Workspace Settings
  "ai-code-agent.autoIndexing": true,
  "ai-code-agent.excludePatterns": [
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**"
  ],
  "ai-code-agent.maxFilesPerOperation": 10,
  
  // Safety Settings
  "ai-code-agent.requireApproval": true,
  "ai-code-agent.backupBeforeChanges": true,
  "ai-code-agent.enableSafeMode": true,
  
  // UI Settings
  "ai-code-agent.showTokenCount": true,
  "ai-code-agent.showCostEstimates": true
}
```

## Architecture

### Extension Structure
```
ai-code-agent/
├── src/
│   ├── extension.ts          # Main entry point
│   ├── core/
│   │   ├── core.ts           # Core agent logic
│   │   ├── contextManager.ts # Context management
│   │   └── sessionState.ts   # Session management
│   ├── managers/
│   │   ├── apiKeyManager.ts  # Secure key storage
│   │   ├── configManager.ts  # Configuration management
│   │   ├── modelManager.ts   # Model selection & management
│   │   └── preprocessor.ts   # Free model integration
│   ├── services/
│   │   ├── indexer.ts        # Workspace indexing
│   │   ├── promptAssistant.ts # Prompt improvement
│   │   ├── diffManager.ts    # Diff generation & preview
│   │   ├── fileEditor.ts     # Safe file operations
│   │   └── taskPlanner.ts    # Task planning system
│   ├── ui/
│   │   ├── chat.ts          # Chat interface
│   │   ├── chat.css         # UI styles
│   │   ├── sessionHistory.ts # Session history tracking
│   │   └── taskProgress.ts  # Progress tracking
│   └── test/
│       └── testSample.ts    # Test files
└── types/
    └── diff.d.ts            # Custom type declarations
```

### Data Flow
1. **User Input** → Prompt Assistant (optional)
2. **Prompt Analysis** → Preprocessor Model
3. **Context Gathering** → Codebase Indexer + Preprocessor
4. **Task Planning** → Claude (planning mode)
5. **Execution** → Claude (editing mode) with preprocessor support
6. **Preview & Approval** → User
7. **Application** → File Editor with backups

## Best Practices

### For Best Results
1. **Be Specific**: Include file names, patterns, or directories
2. **Set Constraints**: Mention what should be preserved
3. **Use Templates**: For common tasks, use the built-in templates
4. **Review Plans**: Always review the execution plan before proceeding
5. **Start Small**: Test on a few files before running on entire codebase

### Cost Optimization
1. **Use Preprocessor**: Let the free model handle indexing and ranking
2. **Batch Operations**: Combine related tasks
3. **Set Token Limits**: Configure maximum tokens per request
4. **Monitor Usage**: Check session history for cost tracking

### Safety Tips
1. **Enable Backups**: Always keep backups enabled
2. **Use Git**: Commit before major operations
3. **Preview Changes**: Review diffs before applying
4. **Test First**: Run on test files before production code

## Troubleshooting

### Common Issues

**Extension not activating**
- Check VS Code version (requires 1.85.0+)
- Verify workspace is open
- Check extension logs

**Ollama connection failed**
- Ensure Ollama is running: `ollama serve`
- Check if running on correct port (11434)
- Try `curl http://localhost:11434/api/tags`

**API key not working**
- Verify key format (sk-ant-...)
- Check for extra spaces
- Ensure key has required permissions

**Indexing taking too long**
- Adjust exclude patterns
- Reduce max file size
- Check for large binary files

**Out of memory errors**
- Reduce chunk sizes
- Limit concurrent operations
- Close other applications

### Debug Mode
Enable debug logging:
```json
"ai-code-agent.debugMode": true
```
View logs: `View → Output → AI Code Agent`

## Privacy & Security

- **API Keys**: Stored securely using VS Code's secret storage
- **Local Processing**: Preprocessor models can run entirely offline
- **No Telemetry**: Unless explicitly enabled in settings
- **File Access**: Only accesses files you approve
- **Backups**: Stored locally in workspace

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details

## Support

- **Issues**: GitHub Issues
- **Discussions**: GitHub Discussions
- **Documentation**: [Wiki](wiki-url)
- **Email**: support@example.com

## Roadmap

- [ ] Support for more preprocessor models
- [ ] Advanced code analysis features
- [ ] Integration with testing frameworks
- [ ] Custom agent behaviors
- [ ] Team collaboration features
- [ ] Performance profiling tools

---

Made with ❤️ by the AI Code Agent team