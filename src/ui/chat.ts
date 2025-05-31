import * as vscode from 'vscode';
import { AgentCore } from '../core/core';
import { PromptAssistant } from '../services/promptAssistant';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'ai-agent-chat';
    private _view?: vscode.WebviewView;
    private messages: ChatMessage[] = [];
    private currentPrompt: string = '';
    private isProcessing: boolean = false;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly agentCore: AgentCore,
        private readonly promptAssistant: PromptAssistant
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
            }
        });

        // Load conversation history
        this.loadHistory();
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
                content: `Analyzing your request...\nComplexity: ${analysis.estimatedComplexity}\nConfidence: ${Math.round(analysis.confidence * 100)}%`,
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
                content: `Error executing task: ${error instanceof Error ? error.message : 'Unknown error'}`,
                timestamp: new Date(),
                isError: true
            });
        } finally {
            this.isProcessing = false;
            this.updateProcessingState();
        }
    }

    private async handleChatMessage(message: string) {
        // Simple chat response - can be enhanced with actual LLM integration
        this.addMessage({
            role: 'assistant',
            content: 'I understand your message. To execute a task, please use the task button or prefix your message with "/task".',
            timestamp: new Date()
        });
    }

    private formatTaskResult(task: any): string {
        const duration = task.completedAt ? 
            `${((task.completedAt.getTime() - task.createdAt.getTime()) / 1000).toFixed(1)}s` : 
            'N/A';

        const filesModified = task.steps
            .filter((s: any) => s.changes)
            .flatMap((s: any) => s.changes.map((c: any) => c.file))
            .filter((f: string, i: number, arr: string[]) => arr.indexOf(f) === i);

        return `Task completed successfully!

**Summary:**
- Status: ${task.status}
- Duration: ${duration}
- Files modified: ${filesModified.length}
- Steps completed: ${task.steps.filter((s: any) => s.status === 'completed').length}/${task.steps.length}

**Modified files:**
${filesModified.map((f: string) => `- ${f}`).join('\n')}

Use the history panel to view detailed changes.`;
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
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="chat.css" rel="stylesheet">
            <link href="${codiconsUri}" rel="stylesheet">
            <title>AI Code Agent Chat</title>
        </head>
        <body>
            <div id="chat-container">
                <div id="prompt-assistant" class="hidden">
                    <div class="assistant-header">
                        <h4>Prompt Assistant</h4>
                        <button class="close-button" onclick="closeAssistant()">
                            <i class="codicon codicon-close"></i>
                        </button>
                    </div>
                    <div id="assistant-content">
                        <div id="suggestions-list"></div>
                        <div id="template-selector" class="hidden">
                            <label>Use a template:</label>
                            <select id="template-dropdown">
                                <option value="">Select a template...</option>
                            </select>
                        </div>
                        <div id="enhanced-prompt" class="hidden">
                            <label>Enhanced prompt:</label>
                            <div class="enhanced-text"></div>
                            <button class="use-enhanced">Use this prompt</button>
                        </div>
                    </div>
                </div>

                <div id="messages-container">
                    <div id="messages-list"></div>
                </div>

                <div id="input-container">
                    <div id="prompt-preview" class="hidden">
                        <div class="preview-header">
                            <span class="complexity-badge"></span>
                            <span class="confidence-score"></span>
                            <button class="edit-prompt" onclick="editPrompt()">
                                <i class="codicon codicon-edit"></i>
                            </button>
                        </div>
                        <div class="preview-content"></div>
                    </div>
                    
                    <div class="input-wrapper">
                        <textarea 
                            id="message-input" 
                            placeholder="Describe what you want the AI agent to do..."
                            rows="3"
                        ></textarea>
                        <div class="input-actions">
                            <button id="analyze-button" class="icon-button" title="Analyze prompt">
                                <i class="codicon codicon-lightbulb"></i>
                            </button>
                            <button id="send-button" class="icon-button" title="Send message">
                                <i class="codicon codicon-send"></i>
                            </button>
                            <button id="execute-button" class="primary-button" title="Execute as task">
                                <i class="codicon codicon-play"></i>
                                Execute Task
                            </button>
                        </div>
                    </div>
                </div>

                <div id="status-bar">
                    <span id="model-info"></span>
                    <span id="token-count"></span>
                    <span id="processing-indicator" class="hidden">
                        <i class="codicon codicon-loading codicon-modifier-spin"></i>
                        Processing...
                    </span>
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

        // Initialize
        document.getElementById('send-button').addEventListener('click', sendMessage);
        document.getElementById('execute-button').addEventListener('click', executeTask);
        document.getElementById('analyze-button').addEventListener('click', analyzePrompt);
        document.getElementById('message-input').addEventListener('keydown', handleKeyPress);
        document.getElementById('message-input').addEventListener('input', handleInputChange);

        function handleKeyPress(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (e.ctrlKey || e.metaKey) {
                    executeTask();
                } else {
                    sendMessage();
                }
            }
        }

        function handleInputChange(e) {
            currentPrompt = e.target.value;
            updateTokenCount();
        }

        function sendMessage() {
            const input = document.getElementById('message-input');
            const message = input.value.trim();
            if (message && !isProcessing) {
                vscode.postMessage({ type: 'sendMessage', message });
                input.value = '';
                currentPrompt = '';
            }
        }

        function executeTask() {
            const input = document.getElementById('message-input');
            const prompt = input.value.trim();
            if (prompt && !isProcessing) {
                vscode.postMessage({ type: 'executeTask', prompt });
                input.value = '';
                currentPrompt = '';
            }
        }

        function analyzePrompt() {
            const prompt = document.getElementById('message-input').value.trim();
            if (prompt) {
                vscode.postMessage({ type: 'analyzePrompt', prompt });
                document.getElementById('prompt-assistant').classList.remove('hidden');
            }
        }

        function closeAssistant() {
            document.getElementById('prompt-assistant').classList.add('hidden');
        }

        function addMessage(message) {
            const messagesContainer = document.getElementById('messages-list');
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + message.role;
            
            const timestamp = new Date(message.timestamp).toLocaleTimeString();
            
            messageDiv.innerHTML = \`
                <div class="message-header">
                    <span class="role">\${message.role === 'user' ? 'You' : 'AI Agent'}</span>
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
            // Convert markdown-like formatting
            return content
                .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
                .replace(/\\n/g, '<br>')
                .replace(/^- (.+)$/gm, '<li>$1</li>')
                .replace(/(<li>.*<\\/li>)/s, '<ul>$1</ul>');
        }

        function updateTokenCount() {
            const count = Math.ceil(currentPrompt.length / 4);
            document.getElementById('token-count').textContent = \`~\${count} tokens\`;
        }

        function showPromptAnalysis(analysis) {
            const suggestionsDiv = document.getElementById('suggestions-list');
            suggestionsDiv.innerHTML = '';
            
            analysis.suggestions.forEach(suggestion => {
                const suggestionDiv = document.createElement('div');
                suggestionDiv.className = \`suggestion \${suggestion.severity}\`;
                suggestionDiv.innerHTML = \`
                    <i class="codicon codicon-\${getSuggestionIcon(suggestion.type)}"></i>
                    <span>\${suggestion.message}</span>
                \`;
                
                if (suggestion.fixes) {
                    const fixesDiv = document.createElement('div');
                    fixesDiv.className = 'fixes';
                    suggestion.fixes.forEach(fix => {
                        const fixButton = document.createElement('button');
                        fixButton.className = 'fix-button';
                        fixButton.textContent = fix.label;
                        fixButton.onclick = () => applyFix(fix);
                        fixesDiv.appendChild(fixButton);
                    });
                    suggestionDiv.appendChild(fixesDiv);
                }
                
                suggestionsDiv.appendChild(suggestionDiv);
            });
            
            // Show enhanced prompt if available
            if (analysis.enhanced && analysis.enhanced !== currentPrompt) {
                const enhancedDiv = document.getElementById('enhanced-prompt');
                enhancedDiv.classList.remove('hidden');
                enhancedDiv.querySelector('.enhanced-text').textContent = analysis.enhanced;
                enhancedDiv.querySelector('.use-enhanced').onclick = () => {
                    document.getElementById('message-input').value = analysis.enhanced;
                    currentPrompt = analysis.enhanced;
                    closeAssistant();
                };
            }
            
            // Update complexity and confidence badges
            const complexityBadge = document.querySelector('.complexity-badge');
            complexityBadge.textContent = \`Complexity: \${analysis.complexity}\`;
            complexityBadge.className = \`complexity-badge \${analysis.complexity}\`;
            
            const confidenceScore = document.querySelector('.confidence-score');
            confidenceScore.textContent = \`Confidence: \${Math.round(analysis.confidence * 100)}%\`;
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

        function applyFix(fix) {
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
            analyzePrompt(); // Re-analyze after applying fix
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
                    closeAssistant();
                    break;
            }
        });

        function updateUI() {
            const sendButton = document.getElementById('send-button');
            const executeButton = document.getElementById('execute-button');
            const input = document.getElementById('message-input');
            const processingIndicator = document.getElementById('processing-indicator');
            
            if (isProcessing) {
                sendButton.disabled = true;
                executeButton.disabled = true;
                input.disabled = true;
                processingIndicator.classList.remove('hidden');
            } else {
                sendButton.disabled = false;
                executeButton.disabled = false;
                input.disabled = false;
                processingIndicator.classList.add('hidden');
            }
        }
        `;
    }
}

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    isError?: boolean;
    metadata?: any;
}