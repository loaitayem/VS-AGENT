import * as vscode from 'vscode';
import { AgentCore } from '../core/core';
import { PromptAssistant } from '../services/promptAssistant';
import { ModelManager } from '../managers/modelManager';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'ai-agent-chat';
    private _view?: vscode.WebviewView;
    private messages: ChatMessage[] = [];
    private currentPrompt: string = '';
    private isProcessing: boolean = false;
    private hasShownWelcome: boolean = false;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly agentCore: AgentCore,
        private readonly promptAssistant: PromptAssistant,
        private readonly modelManager: ModelManager
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };

        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'ready':
                    await this.initializeChat();
                    break;
                case 'sendMessage':
                    await this.handleUserMessage(data.message);
                    break;
                case 'analyzePrompt':
                    await this.handlePromptAnalysis(data.prompt);
                    break;
                case 'applyTemplate':
                    await this.handleTemplateApplication(data.templateId, data.values);
                    break;
                case 'executeTask':
                    await this.handleTaskExecution(data.prompt);
                    break;
                case 'cancelTask':
                    // Implement task cancellation
                    break;
                case 'showDiff':
                    await this.handleShowDiff(data.fileChanges);
                    break;
                case 'changeModel':
                    await this.handleModelChange(data.model, data.mode);
                    break;
                case 'openSettings':
                    vscode.commands.executeCommand('ai-code-agent.selectModel');
                    break;
                case 'useEnhancedPrompt':
                    // Handle using enhanced prompt
                    break;
                case 'applyPromptFix':
                    // Handle applying prompt fix
                    break;
            }
        });

        // Load conversation history
        this.loadHistory();
    }

    private async initializeChat() {
        // Send current model info
        const currentModel = this.modelManager.getCurrentModel();
        const currentMode = this.modelManager.getCurrentMode();
        
        this._view?.webview.postMessage({
            type: 'modelInfo',
            model: currentModel,
            mode: currentMode
        });

        // Show welcome message if first time
        if (!this.hasShownWelcome) {
            this.showWelcomeMessage();
            this.hasShownWelcome = true;
        }

        // Load templates for prompt assistant
        const templates = this.promptAssistant.getTemplates();
        this._view?.webview.postMessage({
            type: 'templatesLoaded',
            templates: templates.map(t => ({
                id: t.id,
                name: t.name,
                category: t.category,
                description: t.description
            }))
        });
    }

    private showWelcomeMessage() {
        const welcomeMessage: ChatMessage = {
            role: 'assistant',
            content: `👋 **Welcome to AI Code Agent!**

I'm your AI-powered coding assistant that can help you with complex code modifications and answer questions about your codebase.

**🚀 Quick Start:**

• **Execute Task** (Ctrl/Cmd + Enter): For code modifications
  - "Refactor all callbacks to async/await"
  - "Add error handling to API endpoints"
  - "Create unit tests for UserService"

• **Chat** (Enter): For questions and discussions
  - "Explain how the auth system works"
  - "What's the best way to optimize this?"
  - "Review this code pattern"

**💡 Pro Tips:**
- Use the Analyze button to improve your prompts
- Select different models from the dropdown above
- Preview all changes before applying them
- Check the history panel for past sessions

Ready to start? Type your request below!`,
            timestamp: new Date(),
            isWelcome: true
        };

        this.messages.push(welcomeMessage);
        this._view?.webview.postMessage({
            type: 'newMessage',
            message: welcomeMessage
        });
    }

    private async handleModelChange(model: string, mode: string) {
        try {
            await this.modelManager.setModel(model, mode as 'thinking' | 'max');
            
            this._view?.webview.postMessage({
                type: 'modelChanged',
                model,
                mode
            });

            this.addMessage({
                role: 'assistant',
                content: `Model changed to **${model} (${mode} mode)**`,
                timestamp: new Date(),
                isSystem: true
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to change model: ${error}`);
        }
    }

    private async handleUserMessage(message: string) {
        this.addMessage({ role: 'user', content: message, timestamp: new Date() });
        
        // Check if this is a task execution request
        if (message.startsWith('/task ')) {
            const task = message.substring(6);
            await this.handleTaskExecution(task);
        } else {
            // Regular chat interaction
            await this.handleChatMessage(message);
        }
    }

    private async handlePromptAnalysis(prompt: string) {
        this.currentPrompt = prompt;
        const analysis = await this.promptAssistant.analyzePrompt(prompt);
        
        this._view?.webview.postMessage({
            type: 'promptAnalysis',
            analysis: {
                suggestions: analysis.suggestions,
                confidence: analysis.confidence,
                complexity: analysis.estimatedComplexity,
                enhanced: analysis.enhanced,
                recommendedModel: analysis.recommendedModel
            }
        });
    }

    private async handleTemplateApplication(templateId: string, values: any) {
        const prompt = await this.promptAssistant.createPromptFromTemplate(templateId, values);
        this._view?.webview.postMessage({
            type: 'templateApplied',
            prompt
        });
    }

    private async handleTaskExecution(prompt: string) {
        this.isProcessing = true;
        this.updateProcessingState();

        try {
            // First analyze the prompt
            const analysis = await this.promptAssistant.analyzePrompt(prompt);
            
            // Show analysis to user
            this.addMessage({
                role: 'assistant',
                content: `📊 **Analyzing your task...**\n\n• Complexity: ${analysis.estimatedComplexity}\n• Confidence: ${Math.round(analysis.confidence * 100)}%\n• Using: ${this.modelManager.getCurrentModel()}\n\n🔄 Executing task...`,
                timestamp: new Date()
            });

            // Execute the task
            await this.agentCore.executeTask(analysis.enhanced);

            // Get results
            const task = this.agentCore.getTaskHistory().slice(-1)[0];
            if (task) {
                this.addMessage({
                    role: 'assistant',
                    content: this.formatTaskResult(task),
                    timestamp: new Date(),
                    metadata: { task }
                });
            }

        } catch (error) {
            this.addMessage({
                role: 'assistant',
                content: `❌ **Error executing task:**\n\n${error instanceof Error ? error.message : 'Unknown error'}\n\n💡 Try breaking down your task into smaller steps or check the logs for details.`,
                timestamp: new Date(),
                isError: true
            });
        } finally {
            this.isProcessing = false;
            this.updateProcessingState();
        }
    }

    private async handleChatMessage(message: string) {
        this.isProcessing = true;
        this.updateProcessingState();

        try {
            // For now, provide helpful guidance
            this.addMessage({
                role: 'assistant',
                content: `I understand you want to discuss: "${message}"\n\n**💡 Note:** Chat mode is for discussions and questions. For code modifications, use the **Execute Task** button.\n\nHow can I help you with this topic?`,
                timestamp: new Date()
            });
        } finally {
            this.isProcessing = false;
            this.updateProcessingState();
        }
    }

    private formatTaskResult(task: any): string {
        const duration = task.completedAt ? 
            `${((task.completedAt.getTime() - task.createdAt.getTime()) / 1000).toFixed(1)}s` : 
            'N/A';

        const filesModified = task.steps
            .filter((s: any) => s.changes)
            .flatMap((s: any) => s.changes.map((c: any) => c.file))
            .filter((f: string, i: number, arr: string[]) => arr.indexOf(f) === i);

        return `✅ **Task completed successfully!**

📊 **Summary:**
• Duration: ${duration}
• Files modified: ${filesModified.length}
• Steps completed: ${task.steps.filter((s: any) => s.status === 'completed').length}/${task.steps.length}

📁 **Modified files:**
${filesModified.map((f: string) => `• \`${f}\``).join('\n')}

💡 Use the history panel to view detailed changes.`;
    }

    private async handleShowDiff(fileChanges: any[]) {
        // Show diff in editor
        for (const change of fileChanges) {
            const uri = vscode.Uri.file(change.file);
            await vscode.commands.executeCommand('vscode.diff', uri, uri, `${change.file} (changes)`);
        }
    }

    private addMessage(message: ChatMessage) {
        this.messages.push(message);
        this._view?.webview.postMessage({
            type: 'newMessage',
            message
        });
        this.saveHistory();
    }

    private updateProcessingState() {
        this._view?.webview.postMessage({
            type: 'processingStateChanged',
            isProcessing: this.isProcessing
        });
    }

    private loadHistory() {
        const history = this.context.globalState.get<ChatMessage[]>('chatHistory', []);
        this.messages = history;
        this._view?.webview.postMessage({
            type: 'loadHistory',
            messages: this.messages
        });
    }

    private saveHistory() {
        // Keep last 100 messages
        const toSave = this.messages.slice(-100);
        this.context.globalState.update('chatHistory', toSave);
    }

    private getHtmlForWebview(webview: vscode.Webview) {
        // Try to use the installed codicons package first, with fallback to CDN
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));
        const chatCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'src', 'ui', 'chat.css'));

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="${codiconsUri}" rel="stylesheet">
            <!-- Fallback CDN for codicons -->
            <link href="https://cdn.jsdelivr.net/npm/@vscode/codicons@0.0.35/dist/codicon.css" rel="stylesheet">
            <link href="${chatCssUri}" rel="stylesheet">
            <title>AI Code Agent Chat</title>
        </head>
        <body>
            <div id="chat-container">
                <!-- Header Section -->
                <div class="header-section">
                    <div class="chat-header">
                        <h2><span class="codicon codicon-robot"></span> AI Code Agent</h2>
                        <div class="header-info">
                            <span id="current-model-display">Loading...</span>
                        </div>
                    </div>
                </div>

                <!-- Messages Area -->
                <div id="messages-container">
                    <div id="messages-list"></div>
                </div>

                <!-- Input Section -->
                <div id="input-section">
                    <div class="input-container">
                        <textarea 
                            id="message-input" 
                            placeholder="Ask AI Agent or describe a task to execute..."
                            rows="3"
                        ></textarea>
                        
                        <!-- Floating Controls at Bottom Right -->
                        <div class="input-controls-overlay">
                            <!-- Model Selector -->
                            <div class="input-model-selector">
                                <select id="input-model-dropdown" title="Select AI Model">
                                    <optgroup label="Claude Opus 4">
                                        <option value="opus-4-thinking">Opus 4 - Thinking</option>
                                        <option value="opus-4-max">Opus 4 - Max</option>
                                    </optgroup>
                                    <optgroup label="Claude Sonnet 4">
                                        <option value="sonnet-4-thinking">Sonnet 4 - Thinking</option>
                                        <option value="sonnet-4-max">Sonnet 4 - Max</option>
                                    </optgroup>
                                </select>
                            </div>
                            
                            <!-- Action Dropdown -->
                            <div class="action-dropdown">
                                <button id="action-dropdown-btn" class="dropdown-button" title="More actions">
                                    <span class="codicon codicon-chevron-down"></span>
                                </button>
                                <div id="action-dropdown-menu" class="dropdown-menu hidden">
                                    <button id="analyze-option" class="dropdown-item" title="Analyze and improve your prompt">
                                        <span class="codicon codicon-lightbulb"></span>
                                        <span>Analyze Prompt</span>
                                    </button>
                                    <button id="execute-option" class="dropdown-item" title="Execute as task (will modify code)">
                                        <span class="codicon codicon-run"></span>
                                        <span>Execute Task</span>
                                    </button>
                                </div>
                            </div>

                            <!-- Send Button -->
                            <button id="send-button" class="send-button" title="Send message">
                                <span class="codicon codicon-send"></span>
                            </button>
                        </div>
                    </div>
                    
                    <div class="input-footer">
                        <div class="help-text">
                            <kbd>Enter</kbd> to send • <kbd>Ctrl+Enter</kbd> for task • <kbd>Ctrl+L</kbd> to analyze
                        </div>
                        <div class="token-counter">
                            <span id="token-count">0 tokens</span>
                        </div>
                    </div>
                </div>

                <!-- Status Bar -->
                <div id="status-bar">
                    <div class="status-item">
                        <span class="codicon codicon-circuit-board"></span>
                        <span id="current-model">Loading...</span>
                    </div>
                    <div class="status-item" id="token-count">
                        <span class="codicon codicon-symbol-numeric"></span>
                        <span>0 tokens</span>
                    </div>
                    <div class="status-item" id="processing-indicator" style="display: none;">
                        <span class="codicon codicon-loading codicon-modifier-spin"></span>
                        <span>Processing...</span>
                    </div>
                </div>

                <!-- Prompt Assistant Overlay -->
                <div id="prompt-assistant-overlay" class="hidden">
                    <div id="prompt-assistant">
                        <div class="assistant-header">
                            <h3><span class="codicon codicon-lightbulb"></span> Prompt Assistant</h3>
                            <button class="close-button" onclick="closeAssistant()">
                                <span class="codicon codicon-close"></span>
                            </button>
                        </div>
                        <div class="assistant-content">
                            <!-- Analysis Results -->
                            <div id="analysis-section">
                                <div class="analysis-metrics">
                                    <div class="metric">
                                        <label>Complexity</label>
                                        <span id="complexity-badge" class="badge">-</span>
                                    </div>
                                    <div class="metric">
                                        <label>Confidence</label>
                                        <span id="confidence-score">-</span>
                                    </div>
                                    <div class="metric">
                                        <label>Recommended</label>
                                        <span id="recommended-model">-</span>
                                    </div>
                                </div>
                            </div>

                            <!-- Suggestions -->
                            <div id="suggestions-section">
                                <h4>Suggestions</h4>
                                <div id="suggestions-list"></div>
                            </div>

                            <!-- Enhanced Prompt -->
                            <div id="enhanced-section" class="hidden">
                                <h4>Enhanced Prompt</h4>
                                <div id="enhanced-prompt-text" class="enhanced-prompt-box"></div>
                                <button class="action-button primary" onclick="useEnhancedPrompt()">
                                    <span class="codicon codicon-check"></span>
                                    Use Enhanced Prompt
                                </button>
                            </div>

                            <!-- Templates -->
                            <div id="templates-section">
                                <h4>Templates</h4>
                                <select id="template-selector">
                                    <option value="">Select a template...</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                ${this.getChatScript()}
            </script>
        </body>
        </html>`;
    }

    private getChatScript(): string {
        return `
        let currentPrompt = '';
        let isProcessing = false;
        let currentModel = 'claude-opus-4';
        let currentMode = 'thinking';
        let templates = [];
        let currentAnalysis = null;

        // Model descriptions
        const modelDescriptions = {
            'opus-4-thinking': 'Most powerful, careful reasoning',
            'opus-4-max': 'Most powerful, faster responses',
            'sonnet-4-thinking': 'Cost-effective, careful reasoning',
            'sonnet-4-max': 'Cost-effective, faster responses'
        };

        // Initialize when ready
        window.addEventListener('load', () => {
            vscode.postMessage({ type: 'ready' });
            initializeEventListeners();
        });

        function initializeEventListeners() {
            document.getElementById('send-button').addEventListener('click', sendMessage);
            document.getElementById('message-input').addEventListener('keydown', handleKeyPress);
            document.getElementById('message-input').addEventListener('input', handleInputChange);
            document.getElementById('template-selector').addEventListener('change', handleTemplateSelect);
            document.getElementById('input-model-dropdown').addEventListener('change', handleModelChange);
            
            // Action dropdown events
            document.getElementById('action-dropdown-btn').addEventListener('click', toggleActionDropdown);
            document.getElementById('analyze-option').addEventListener('click', analyzePrompt);
            document.getElementById('execute-option').addEventListener('click', executeTask);
            
            // Close dropdown when clicking outside
            document.addEventListener('click', closeDropdownOnOutsideClick);
            
            // Auto-resize textarea
            const textarea = document.getElementById('message-input');
            textarea.addEventListener('input', autoResizeTextarea);
        }

        function handleKeyPress(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (e.ctrlKey || e.metaKey) {
                    executeTask();
                } else {
                    sendMessage();
                }
            } else if (e.key === 'l' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                analyzePrompt();
            }
        }

        function handleInputChange(e) {
            currentPrompt = e.target.value;
            updateTokenCount();
        }

        function updateTokenCount() {
            const count = Math.ceil(currentPrompt.length / 4);
            document.querySelector('#token-count span').textContent = \`\${count} tokens\`;
        }

        function sendMessage() {
            const input = document.getElementById('message-input');
            const message = input.value.trim();
            if (message && !isProcessing) {
                vscode.postMessage({ type: 'sendMessage', message });
                input.value = '';
                currentPrompt = '';
                updateTokenCount();
            }
        }

        function executeTask() {
            const input = document.getElementById('message-input');
            const prompt = input.value.trim();
            if (prompt && !isProcessing) {
                vscode.postMessage({ type: 'executeTask', prompt });
                input.value = '';
                currentPrompt = '';
                updateTokenCount();
                autoResizeTextarea();
            }
            // Close dropdown
            document.getElementById('action-dropdown-menu').classList.add('hidden');
        }

        function analyzePrompt() {
            const prompt = document.getElementById('message-input').value.trim();
            if (prompt) {
                vscode.postMessage({ type: 'analyzePrompt', prompt });
                document.getElementById('prompt-assistant-overlay').classList.remove('hidden');
            }
            // Close dropdown
            document.getElementById('action-dropdown-menu').classList.add('hidden');
        }

        function closeAssistant() {
            document.getElementById('prompt-assistant-overlay').classList.add('hidden');
        }

        function handleModelChange() {
            const dropdown = document.getElementById('input-model-dropdown');
            const selected = dropdown.value;
            const [model, mode] = selected.includes('opus') 
                ? ['claude-opus-4', selected.split('-')[2]]
                : ['claude-sonnet-4', selected.split('-')[2]];
            
            vscode.postMessage({ 
                type: 'changeModel', 
                model, 
                mode 
            });

            updateModelDisplay(model, mode);
        }

        function updateModelDisplay(model, mode) {
            const modelText = model.includes('opus') ? 'Opus 4' : 'Sonnet 4';
            const modeText = mode === 'thinking' ? 'Thinking' : 'Max';
            document.getElementById('current-model-display').textContent = \`\${modelText} - \${modeText}\`;
        }

        function toggleActionDropdown() {
            const menu = document.getElementById('action-dropdown-menu');
            menu.classList.toggle('hidden');
        }

        function closeDropdownOnOutsideClick(event) {
            const dropdown = document.getElementById('action-dropdown-menu');
            const button = document.getElementById('action-dropdown-btn');
            
            if (!dropdown.contains(event.target) && !button.contains(event.target)) {
                dropdown.classList.add('hidden');
            }
        }

        function autoResizeTextarea() {
            const textarea = document.getElementById('message-input');
            const container = document.querySelector('.input-container');
            
            // Reset height to auto to get the actual scroll height
            textarea.style.height = 'auto';
            
            // Calculate new height with constraints
            const minHeight = 80; // Minimum container height
            const maxHeight = 200; // Maximum height
            const contentHeight = Math.max(textarea.scrollHeight + 20, minHeight); // +20 for padding
            const newHeight = Math.min(contentHeight, maxHeight);
            
            // Apply to both textarea and container
            textarea.style.height = (newHeight - 20) + 'px'; // -20 for padding
            container.style.minHeight = newHeight + 'px';
        }

        function handleTemplateSelect() {
            const selector = document.getElementById('template-selector');
            const templateId = selector.value;
            if (templateId) {
                const template = templates.find(t => t.id === templateId);
                if (template) {
                    // For now, just close the assistant and use template
                    vscode.postMessage({ 
                        type: 'applyTemplate', 
                        templateId: templateId,
                        values: {} 
                    });
                }
            }
        }

        function useEnhancedPrompt() {
            if (currentAnalysis && currentAnalysis.enhanced) {
                document.getElementById('message-input').value = currentAnalysis.enhanced;
                currentPrompt = currentAnalysis.enhanced;
                updateTokenCount();
                closeAssistant();
            }
        }

        function applyPromptFix(fix) {
            const input = document.getElementById('message-input');
            if (fix.position) {
                const text = input.value;
                input.value = text.substring(0, fix.position.start) + 
                             fix.newText + 
                             text.substring(fix.position.end);
            } else {
                input.value = fix.newText;
            }
            currentPrompt = input.value;
            updateTokenCount();
            
            // Re-analyze after applying fix
            vscode.postMessage({ type: 'analyzePrompt', prompt: currentPrompt });
        }

        function addMessage(message) {
            const messagesContainer = document.getElementById('messages-list');
            const messageDiv = document.createElement('div');
            
            if (message.isWelcome) {
                messageDiv.className = 'message assistant welcome-message';
            } else if (message.isSystem) {
                messageDiv.className = 'system-message';
                messageDiv.innerHTML = formatContent(message.content);
                messagesContainer.appendChild(messageDiv);
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
                return;
            } else {
                messageDiv.className = 'message ' + message.role;
            }
            
            const timestamp = new Date(message.timestamp).toLocaleTimeString();
            
            messageDiv.innerHTML = \`
                <div class="message-header">
                    <span class="role">\${message.role === 'user' ? '👤 You' : '🤖 AI Agent'}</span>
                    <span class="timestamp">\${timestamp}</span>
                </div>
                <div class="message-content">\${formatContent(message.content)}</div>
            \`;
            
            if (message.isError) {
                messageDiv.classList.add('error');
            }
            
            messagesContainer.appendChild(messageDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        function formatContent(content) {
            return content
                .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
                .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
                .replace(/\\n/g, '<br>')
                .replace(/^• (.+)$/gm, '<li>$1</li>')
                .replace(/(<li>.*<\\/li>)/s, '<ul>$1</ul>');
        }

        function showPromptAnalysis(analysis) {
            currentAnalysis = analysis;

            // Update metrics
            document.getElementById('complexity-badge').textContent = analysis.complexity;
            document.getElementById('complexity-badge').className = 'badge ' + analysis.complexity;
            document.getElementById('confidence-score').textContent = Math.round(analysis.confidence * 100) + '%';
            document.getElementById('recommended-model').textContent = analysis.recommendedModel;

            // Show suggestions
            const suggestionsDiv = document.getElementById('suggestions-list');
            suggestionsDiv.innerHTML = '';
            
            analysis.suggestions.forEach(suggestion => {
                const suggestionDiv = document.createElement('div');
                suggestionDiv.className = 'suggestion-item ' + suggestion.severity;
                
                let fixesHtml = '';
                if (suggestion.fixes && suggestion.fixes.length > 0) {
                    fixesHtml = '<div class="suggestion-fixes">' +
                        suggestion.fixes.map(fix => 
                            \`<button class="fix-button" onclick='applyPromptFix(\${JSON.stringify(fix)})'>\${fix.label}</button>\`
                        ).join('') +
                        '</div>';
                }
                
                suggestionDiv.innerHTML = \`
                    <div class="suggestion-content">
                        <span class="codicon codicon-\${getSuggestionIcon(suggestion.type)}"></span>
                        <span>\${suggestion.message}</span>
                    </div>
                    \${fixesHtml}
                \`;
                
                suggestionsDiv.appendChild(suggestionDiv);
            });

            // Show enhanced prompt if available
            if (analysis.enhanced && analysis.enhanced !== currentPrompt) {
                document.getElementById('enhanced-section').classList.remove('hidden');
                document.getElementById('enhanced-prompt-text').textContent = analysis.enhanced;
            } else {
                document.getElementById('enhanced-section').classList.add('hidden');
            }
        }

        function getSuggestionIcon(type) {
            const icons = {
                clarification: 'question',
                improvement: 'lightbulb',
                warning: 'warning',
                template: 'file-code'
            };
            return icons[type] || 'info';
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'newMessage':
                    addMessage(message.message);
                    break;
                case 'loadHistory':
                    message.messages.forEach(addMessage);
                    break;
                case 'promptAnalysis':
                    showPromptAnalysis(message.analysis);
                    break;
                case 'processingStateChanged':
                    isProcessing = message.isProcessing;
                    updateUI();
                    break;
                case 'templateApplied':
                    document.getElementById('message-input').value = message.prompt;
                    currentPrompt = message.prompt;
                    updateTokenCount();
                    closeAssistant();
                    break;
                case 'modelInfo':
                    currentModel = message.model;
                    currentMode = message.mode;
                    updateModelUI(message.model, message.mode);
                    break;
                case 'modelChanged':
                    currentModel = message.model;
                    currentMode = message.mode;
                    updateModelUI(message.model, message.mode);
                    break;
                case 'templatesLoaded':
                    templates = message.templates;
                    updateTemplateSelector();
                    break;
            }
        });

        function updateModelUI(model, mode) {
            const dropdown = document.getElementById('model-dropdown');
            const modelKey = model.includes('opus') 
                ? \`opus-4-\${mode}\`
                : \`sonnet-4-\${mode}\`;
            dropdown.value = modelKey;
            
            const modelText = model.includes('opus') ? 'Opus 4' : 'Sonnet 4';
            const modeText = mode === 'thinking' ? 'Thinking' : 'Max';
            document.getElementById('current-model').textContent = \`\${modelText} - \${modeText}\`;
            document.getElementById('model-description').textContent = modelDescriptions[modelKey];
        }

        function updateTemplateSelector() {
            const selector = document.getElementById('template-selector');
            selector.innerHTML = '<option value="">Select a template...</option>';
            
            const categories = {};
            templates.forEach(template => {
                if (!categories[template.category]) {
                    categories[template.category] = [];
                }
                categories[template.category].push(template);
            });

            Object.entries(categories).forEach(([category, categoryTemplates]) => {
                const optgroup = document.createElement('optgroup');
                optgroup.label = category.charAt(0).toUpperCase() + category.slice(1);
                
                categoryTemplates.forEach(template => {
                    const option = document.createElement('option');
                    option.value = template.id;
                    option.textContent = template.name;
                    option.title = template.description;
                    optgroup.appendChild(option);
                });
                
                selector.appendChild(optgroup);
            });
        }

        function updateUI() {
            const sendButton = document.getElementById('send-button');
            const input = document.getElementById('message-input');
            const processingIndicator = document.getElementById('processing-indicator');
            const modelDropdown = document.getElementById('input-model-dropdown');
            const actionDropdownBtn = document.getElementById('action-dropdown-btn');
            
            if (isProcessing) {
                sendButton.disabled = true;
                input.disabled = true;
                modelDropdown.disabled = true;
                actionDropdownBtn.disabled = true;
                processingIndicator.style.display = 'flex';
            } else {
                sendButton.disabled = false;
                input.disabled = false;
                modelDropdown.disabled = false;
                actionDropdownBtn.disabled = false;
                processingIndicator.style.display = 'none';
            }
        }

        // Click outside to close assistant
        document.getElementById('prompt-assistant-overlay').addEventListener('click', function(e) {
            if (e.target === this) {
                closeAssistant();
            }
        });
        `;
    }
}

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    isError?: boolean;
    isWelcome?: boolean;
    isSystem?: boolean;
    metadata?: any;
}