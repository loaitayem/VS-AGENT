import * as vscode from 'vscode';
import { AgentCore } from './core/core';
import { PromptAssistant } from './services/promptAssistant';
import { ApiKeyManager } from './managers/apiKeyManager';
import { ChatViewProvider } from './ui/chat';
import { CodebaseIndexer } from './services/indexer';
import { ModelManager } from './managers/modelManager';
import { PreprocessorManager } from './managers/preprocessor';
import { SessionHistoryProvider } from './ui/sessionHistory';
import { TaskProgressProvider } from './ui/taskProgress';

let agentCore: AgentCore;
let indexer: CodebaseIndexer;
let apiKeyManager: ApiKeyManager;
let modelManager: ModelManager;
let preprocessorManager: PreprocessorManager;
let promptAssistant: PromptAssistant;

export async function activate(context: vscode.ExtensionContext) {
    console.log('AI Code Agent extension is now active');

    // Initialize core components
    apiKeyManager = new ApiKeyManager(context);
    modelManager = new ModelManager(context);
    preprocessorManager = new PreprocessorManager(context);
    indexer = new CodebaseIndexer(context, preprocessorManager);
    agentCore = new AgentCore(apiKeyManager, modelManager, indexer, preprocessorManager);
    promptAssistant = new PromptAssistant(preprocessorManager);

    // Initialize UI providers
    const chatProvider = new ChatViewProvider(context, agentCore, promptAssistant);
    const taskProvider = new TaskProgressProvider(context, agentCore);
    const historyProvider = new SessionHistoryProvider(context, agentCore);

    // Register webview providers
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('ai-agent-chat', chatProvider),
        vscode.window.registerTreeDataProvider('ai-agent-tasks', taskProvider),
        vscode.window.registerTreeDataProvider('ai-agent-history', historyProvider)
    );

    // Register commands
    registerCommands(context);

    // Auto-index workspace if enabled
    const config = vscode.workspace.getConfiguration('ai-code-agent');
    if (config.get('autoIndexing')) {
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Indexing workspace...",
            cancellable: false
        }, async (progress) => {
            await indexer.indexWorkspace(progress);
        });
    }

    // Watch for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('ai-code-agent')) {
                modelManager.updateConfiguration();
                preprocessorManager.updateConfiguration();
            }
        })
    );

    // Set up file watchers for index updates
    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
    context.subscriptions.push(
        fileWatcher.onDidCreate(uri => indexer.addFile(uri)),
        fileWatcher.onDidChange(uri => indexer.updateFile(uri)),
        fileWatcher.onDidDelete(uri => indexer.removeFile(uri))
    );
}

function registerCommands(context: vscode.ExtensionContext) {
    // Start chat command
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-code-agent.startChat', async () => {
            vscode.commands.executeCommand('ai-agent-sidebar.focus');
        })
    );

    // Set API key command
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-code-agent.setApiKey', async () => {
            const key = await vscode.window.showInputBox({
                prompt: 'Enter your Anthropic API key',
                password: true,
                placeHolder: 'sk-ant-...'
            });
            
            if (key) {
                await apiKeyManager.setApiKey(key);
                vscode.window.showInformationMessage('API key saved securely');
            }
        })
    );

    // Select model command
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-code-agent.selectModel', async () => {
            const models = ['claude-opus-4', 'claude-sonnet-4'];
            const modes = ['thinking', 'max'];
            
            const model = await vscode.window.showQuickPick(models, {
                placeHolder: 'Select Claude model'
            });
            
            if (model) {
                const mode = await vscode.window.showQuickPick(modes, {
                    placeHolder: 'Select mode'
                });
                
                if (mode) {
                    await modelManager.setModel(model, mode as 'thinking' | 'max');
                    vscode.window.showInformationMessage(`Selected ${model} in ${mode} mode`);
                }
            }
        })
    );

    // Execute task command
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-code-agent.executeTask', async () => {
            const task = await vscode.window.showInputBox({
                prompt: 'Enter your task for the AI agent',
                placeHolder: 'e.g., Refactor all promise code to async/await'
            });
            
            if (task) {
                await agentCore.executeTask(task);
            }
        })
    );

    // Index workspace command
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-code-agent.indexWorkspace', async () => {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Indexing workspace...",
                cancellable: true
            }, async (progress, token) => {
                await indexer.indexWorkspace(progress, token);
            });
        })
    );

    // Configure preprocessor command
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-code-agent.configurePreprocessor', async () => {
            const models = ['llama3', 'gemini-1.5-pro', 'codellama', 'local-ollama'];
            const selected = await vscode.window.showQuickPick(models, {
                placeHolder: 'Select preprocessor model'
            });
            
            if (selected) {
                await preprocessorManager.configureModel(selected);
                
                // Additional configuration for specific models
                if (selected === 'gemini-1.5-pro') {
                    const apiKey = await vscode.window.showInputBox({
                        prompt: 'Enter your Google AI API key',
                        password: true
                    });
                    if (apiKey) {
                        await preprocessorManager.setApiKey('gemini', apiKey);
                    }
                } else if (selected === 'local-ollama') {
                    const endpoint = await vscode.window.showInputBox({
                        prompt: 'Enter Ollama endpoint',
                        value: 'http://localhost:11434'
                    });
                    if (endpoint) {
                        await preprocessorManager.setEndpoint('ollama', endpoint);
                    }
                }
                
                vscode.window.showInformationMessage(`Preprocessor model set to ${selected}`);
            }
        })
    );

    // Show history command
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-code-agent.showHistory', () => {
            vscode.commands.executeCommand('ai-agent-history.focus');
        })
    );
}

export function deactivate() {
    if (agentCore) {
        agentCore.dispose();
    }
    if (indexer) {
        indexer.dispose();
    }
}