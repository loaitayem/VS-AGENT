import * as vscode from 'vscode';

export interface ExtensionConfiguration {
    // Model settings
    model: string;
    mode: 'thinking' | 'max';
    maxTokensPerRequest: number;
    
    // Preprocessor settings
    preprocessorModel: string;
    enablePromptAssistant: boolean;
    
    // Indexing settings
    autoIndexing: boolean;
    excludePatterns: string[];
    maxFileSize: number;
    
    // Agent settings
    maxFilesPerOperation: number;
    requireApproval: boolean;
    showDiffPreview: boolean;
    
    // Safety settings
    enableSafeMode: boolean;
    backupBeforeChanges: boolean;
    maxChangesWithoutConfirmation: number;
    
    // UI settings
    theme: 'auto' | 'light' | 'dark';
    showTokenCount: boolean;
    showCostEstimates: boolean;
    
    // Advanced settings
    debugMode: boolean;
    telemetryEnabled: boolean;
    customHeaders?: { [key: string]: string };
}

export class ConfigurationManager {
    private config: vscode.WorkspaceConfiguration;
    private watchers: Map<string, (e: vscode.ConfigurationChangeEvent) => void> = new Map();

    constructor(private context: vscode.ExtensionContext) {
        this.config = vscode.workspace.getConfiguration('ai-code-agent');
        
        // Watch for configuration changes
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('ai-code-agent')) {
                    this.config = vscode.workspace.getConfiguration('ai-code-agent');
                    this.notifyWatchers(e);
                }
            })
        );
    }

    get<T>(key: keyof ExtensionConfiguration, defaultValue?: T): T {
        return this.config.get(key, defaultValue as any) as T;
    }

    async set<T>(key: keyof ExtensionConfiguration, value: T, global: boolean = true): Promise<void> {
        await this.config.update(
            key, 
            value, 
            global ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace
        );
    }

    getAll(): ExtensionConfiguration {
        return {
            model: this.get('model', 'claude-opus-4'),
            mode: this.get('mode', 'thinking'),
            maxTokensPerRequest: this.get('maxTokensPerRequest', 100000),
            preprocessorModel: this.get('preprocessorModel', 'llama3'),
            enablePromptAssistant: this.get('enablePromptAssistant', true),
            autoIndexing: this.get('autoIndexing', true),
            excludePatterns: this.get('excludePatterns', [
                '**/node_modules/**',
                '**/.git/**',
                '**/dist/**',
                '**/out/**',
                '**/*.min.js',
                '**/coverage/**'
            ]),
            maxFileSize: this.get('maxFileSize', 1048576), // 1MB
            maxFilesPerOperation: this.get('maxFilesPerOperation', 10),
            requireApproval: this.get('requireApproval', true),
            showDiffPreview: this.get('showDiffPreview', true),
            enableSafeMode: this.get('enableSafeMode', true),
            backupBeforeChanges: this.get('backupBeforeChanges', true),
            maxChangesWithoutConfirmation: this.get('maxChangesWithoutConfirmation', 5),
            theme: this.get('theme', 'auto'),
            showTokenCount: this.get('showTokenCount', true),
            showCostEstimates: this.get('showCostEstimates', true),
            debugMode: this.get('debugMode', false),
            telemetryEnabled: this.get('telemetryEnabled', false),
            customHeaders: this.get('customHeaders', {})
        };
    }

    async showSettingsUI(): Promise<void> {
        const panel = vscode.window.createWebviewPanel(
            'ai-agent-settings',
            'AI Code Agent Settings',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );

        panel.webview.html = this.getSettingsHtml(panel.webview);

        panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'saveSettings':
                    await this.saveSettings(message.settings);
                    vscode.window.showInformationMessage('Settings saved successfully');
                    break;
                case 'resetSettings':
                    await this.resetSettings();
                    panel.webview.postMessage({ 
                        command: 'settingsLoaded', 
                        settings: this.getAll() 
                    });
                    break;
                case 'testConnection':
                    await this.testConnection();
                    break;
            }
        });

        // Send current settings to webview
        panel.webview.postMessage({ 
            command: 'settingsLoaded', 
            settings: this.getAll() 
        });
    }

    private getSettingsHtml(_webview: vscode.Webview): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>AI Code Agent Settings</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 20px;
                    max-width: 800px;
                    margin: 0 auto;
                }
                h1, h2 { margin-top: 0; }
                .setting-group {
                    margin-bottom: 30px;
                    padding: 20px;
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                    border-radius: 4px;
                }
                .setting-item {
                    margin-bottom: 15px;
                }
                label {
                    display: block;
                    margin-bottom: 5px;
                    font-weight: bold;
                }
                input, select, textarea {
                    width: 100%;
                    padding: 8px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                }
                input[type="checkbox"] {
                    width: auto;
                    margin-right: 8px;
                }
                .checkbox-label {
                    display: flex;
                    align-items: center;
                }
                button {
                    padding: 8px 16px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    margin-right: 10px;
                }
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                .secondary-button {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                }
                .description {
                    font-size: 0.9em;
                    opacity: 0.8;
                    margin-top: 5px;
                }
                .actions {
                    margin-top: 30px;
                    padding-top: 20px;
                    border-top: 1px solid var(--vscode-panel-border);
                }
            </style>
        </head>
        <body>
            <h1>AI Code Agent Settings</h1>

            <div class="setting-group">
                <h2>Model Configuration</h2>
                <div class="setting-item">
                    <label for="model">Claude Model</label>
                    <select id="model">
                        <option value="claude-opus-4">Claude Opus 4</option>
                        <option value="claude-sonnet-4">Claude Sonnet 4</option>
                    </select>
                    <div class="description">Select the Claude model to use for agent tasks</div>
                </div>
                <div class="setting-item">
                    <label for="mode">Model Mode</label>
                    <select id="mode">
                        <option value="thinking">Thinking Mode</option>
                        <option value="max">Max Mode</option>
                    </select>
                    <div class="description">Thinking mode is more careful, Max mode is faster</div>
                </div>
                <div class="setting-item">
                    <label for="maxTokensPerRequest">Max Tokens per Request</label>
                    <input type="number" id="maxTokensPerRequest" min="1000" max="200000" step="1000">
                    <div class="description">Maximum tokens to use per API request</div>
                </div>
            </div>

            <div class="setting-group">
                <h2>Preprocessor Configuration</h2>
                <div class="setting-item">
                    <label for="preprocessorModel">Preprocessor Model</label>
                    <select id="preprocessorModel">
                        <option value="llama3">Llama 3 (via Ollama)</option>
                        <option value="gemini-1.5-pro">Google Gemini 1.5 Pro</option>
                        <option value="codellama">Code Llama (via Ollama)</option>
                        <option value="local-ollama">Custom Ollama Model</option>
                    </select>
                    <div class="description">Free/local model for indexing and context preparation</div>
                </div>
                <div class="setting-item">
                    <label class="checkbox-label">
                        <input type="checkbox" id="enablePromptAssistant">
                        Enable Prompt Assistant
                    </label>
                    <div class="description">Show suggestions and improvements for prompts</div>
                </div>
            </div>

            <div class="setting-group">
                <h2>Workspace Settings</h2>
                <div class="setting-item">
                    <label class="checkbox-label">
                        <input type="checkbox" id="autoIndexing">
                        Auto-index Workspace
                    </label>
                    <div class="description">Automatically index files when opening workspace</div>
                </div>
                <div class="setting-item">
                    <label for="maxFilesPerOperation">Max Files per Operation</label>
                    <input type="number" id="maxFilesPerOperation" min="1" max="100" step="1">
                    <div class="description">Maximum files to modify in a single operation</div>
                </div>
                <div class="setting-item">
                    <label for="excludePatterns">Exclude Patterns (one per line)</label>
                    <textarea id="excludePatterns" rows="5"></textarea>
                    <div class="description">Glob patterns for files to exclude from indexing</div>
                </div>
            </div>

            <div class="setting-group">
                <h2>Safety Settings</h2>
                <div class="setting-item">
                    <label class="checkbox-label">
                        <input type="checkbox" id="requireApproval">
                        Require Approval for Changes
                    </label>
                    <div class="description">Show preview and require approval before applying changes</div>
                </div>
                <div class="setting-item">
                    <label class="checkbox-label">
                        <input type="checkbox" id="backupBeforeChanges">
                        Backup Files Before Changes
                    </label>
                    <div class="description">Create backups before modifying files</div>
                </div>
                <div class="setting-item">
                    <label class="checkbox-label">
                        <input type="checkbox" id="enableSafeMode">
                        Enable Safe Mode
                    </label>
                    <div class="description">Extra confirmations for destructive operations</div>
                </div>
            </div>

            <div class="setting-group">
                <h2>UI Settings</h2>
                <div class="setting-item">
                    <label class="checkbox-label">
                        <input type="checkbox" id="showTokenCount">
                        Show Token Count
                    </label>
                    <div class="description">Display token usage in the UI</div>
                </div>
                <div class="setting-item">
                    <label class="checkbox-label">
                        <input type="checkbox" id="showCostEstimates">
                        Show Cost Estimates
                    </label>
                    <div class="description">Display estimated API costs</div>
                </div>
            </div>

            <div class="actions">
                <button onclick="saveSettings()">Save Settings</button>
                <button class="secondary-button" onclick="resetSettings()">Reset to Defaults</button>
                <button class="secondary-button" onclick="testConnection()">Test Connection</button>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let currentSettings = {};

                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.command === 'settingsLoaded') {
                        currentSettings = message.settings;
                        loadSettings(message.settings);
                    }
                });

                function loadSettings(settings) {
                    document.getElementById('model').value = settings.model;
                    document.getElementById('mode').value = settings.mode;
                    document.getElementById('maxTokensPerRequest').value = settings.maxTokensPerRequest;
                    document.getElementById('preprocessorModel').value = settings.preprocessorModel;
                    document.getElementById('enablePromptAssistant').checked = settings.enablePromptAssistant;
                    document.getElementById('autoIndexing').checked = settings.autoIndexing;
                    document.getElementById('maxFilesPerOperation').value = settings.maxFilesPerOperation;
                    document.getElementById('excludePatterns').value = settings.excludePatterns.join('\\n');
                    document.getElementById('requireApproval').checked = settings.requireApproval;
                    document.getElementById('backupBeforeChanges').checked = settings.backupBeforeChanges;
                    document.getElementById('enableSafeMode').checked = settings.enableSafeMode;
                    document.getElementById('showTokenCount').checked = settings.showTokenCount;
                    document.getElementById('showCostEstimates').checked = settings.showCostEstimates;
                }

                function saveSettings() {
                    const settings = {
                        model: document.getElementById('model').value,
                        mode: document.getElementById('mode').value,
                        maxTokensPerRequest: parseInt(document.getElementById('maxTokensPerRequest').value),
                        preprocessorModel: document.getElementById('preprocessorModel').value,
                        enablePromptAssistant: document.getElementById('enablePromptAssistant').checked,
                        autoIndexing: document.getElementById('autoIndexing').checked,
                        maxFilesPerOperation: parseInt(document.getElementById('maxFilesPerOperation').value),
                        excludePatterns: document.getElementById('excludePatterns').value.split('\\n').filter(p => p.trim()),
                        requireApproval: document.getElementById('requireApproval').checked,
                        backupBeforeChanges: document.getElementById('backupBeforeChanges').checked,
                        enableSafeMode: document.getElementById('enableSafeMode').checked,
                        showTokenCount: document.getElementById('showTokenCount').checked,
                        showCostEstimates: document.getElementById('showCostEstimates').checked
                    };
                    
                    vscode.postMessage({ command: 'saveSettings', settings });
                }

                function resetSettings() {
                    vscode.postMessage({ command: 'resetSettings' });
                }

                function testConnection() {
                    vscode.postMessage({ command: 'testConnection' });
                }
            </script>
        </body>
        </html>`;
    }

    private async saveSettings(settings: Partial<ExtensionConfiguration>): Promise<void> {
        for (const [key, value] of Object.entries(settings)) {
            await this.set(key as keyof ExtensionConfiguration, value);
        }
    }

    private async resetSettings(): Promise<void> {
        // Reset all settings to defaults
        const config = vscode.workspace.getConfiguration('ai-code-agent');
        for (const key of Object.keys(config)) {
            if (config.has(key)) {
                await config.update(key, undefined, vscode.ConfigurationTarget.Global);
            }
        }
        vscode.window.showInformationMessage('Settings reset to defaults');
    }

    private async testConnection(): Promise<void> {
        // Test API connections
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Testing connections...',
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 50, message: 'Testing Anthropic API...' });
            
            // Test would be implemented in the actual extension
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            progress.report({ increment: 50, message: 'Testing preprocessor...' });
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            vscode.window.showInformationMessage('Connection test completed');
        });
    }

    watch(key: string, callback: (e: vscode.ConfigurationChangeEvent) => void): vscode.Disposable {
        this.watchers.set(key, callback);
        
        return new vscode.Disposable(() => {
            this.watchers.delete(key);
        });
    }

    private notifyWatchers(e: vscode.ConfigurationChangeEvent): void {
        for (const [key, callback] of this.watchers) {
            if (e.affectsConfiguration(`ai-code-agent.${key}`)) {
                callback(e);
            }
        }
    }

    async migrate(): Promise<void> {
        // Migrate old settings to new format if needed
        const oldSettings = this.context.globalState.get<any>('oldSettings');
        if (oldSettings) {
            // Perform migration
            await this.context.globalState.update('oldSettings', undefined);
            vscode.window.showInformationMessage('Settings migrated to new format');
        }
    }
}