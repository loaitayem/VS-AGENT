import * as vscode from 'vscode';

export interface ModelConfig {
    id: string;
    name: string;
    model: string;
    mode: 'thinking' | 'max';
    maxTokens: number;
    contextWindow: number;
    costPer1MInput: number;
    costPer1MOutput: number;
}

export class ModelManager {
    private currentModel: string;
    private currentMode: 'thinking' | 'max';
    
    private readonly models: Map<string, ModelConfig> = new Map([
        ['claude-opus-4-thinking', {
            id: 'claude-opus-4-thinking',
            name: 'Claude Opus 4 (Thinking)',
            model: 'claude-opus-4-20250514',
            mode: 'thinking',
            maxTokens: 4096,
            contextWindow: 200000,
            costPer1MInput: 15,
            costPer1MOutput: 75
        }],
        ['claude-opus-4-max', {
            id: 'claude-opus-4-max',
            name: 'Claude Opus 4 (Max)',
            model: 'claude-opus-4-20250514',
            mode: 'max',
            maxTokens: 8192,
            contextWindow: 200000,
            costPer1MInput: 15,
            costPer1MOutput: 75
        }],
        ['claude-sonnet-4-thinking', {
            id: 'claude-sonnet-4-thinking',
            name: 'Claude Sonnet 4 (Thinking)',
            model: 'claude-sonnet-4-20250514',
            mode: 'thinking',
            maxTokens: 4096,
            contextWindow: 200000,
            costPer1MInput: 3,
            costPer1MOutput: 15
        }],
        ['claude-sonnet-4-max', {
            id: 'claude-sonnet-4-max',
            name: 'Claude Sonnet 4 (Max)',
            model: 'claude-sonnet-4-20250514',
            mode: 'max',
            maxTokens: 8192,
            contextWindow: 200000,
            costPer1MInput: 3,
            costPer1MOutput: 15
        }]
    ]);

    constructor(private context: vscode.ExtensionContext) {
        const config = vscode.workspace.getConfiguration('ai-code-agent');
        this.currentModel = config.get('model', 'claude-opus-4');
        this.currentMode = config.get('mode', 'thinking');
    }

    async setModel(model: string, mode: 'thinking' | 'max'): Promise<void> {
        this.currentModel = model;
        this.currentMode = mode;
        
        const config = vscode.workspace.getConfiguration('ai-code-agent');
        await config.update('model', model, vscode.ConfigurationTarget.Global);
        await config.update('mode', mode, vscode.ConfigurationTarget.Global);
        
        // Fire configuration change event
        vscode.commands.executeCommand('ai-code-agent.modelChanged', { model, mode });
    }

    getCurrentModel(): string {
        return this.currentModel;
    }

    getCurrentMode(): 'thinking' | 'max' {
        return this.currentMode;
    }

    getCurrentConfig(): ModelConfig | undefined {
        const configId = `${this.currentModel}-${this.currentMode}`;
        return this.models.get(configId);
    }

    getMaxTokens(): number {
        const config = this.getCurrentConfig();
        const customMax = vscode.workspace.getConfiguration('ai-code-agent').get<number>('maxTokensPerRequest');
        
        if (customMax && customMax > 0) {
            return Math.min(customMax, config?.maxTokens || 4096);
        }
        
        return config?.maxTokens || 4096;
    }

    getContextWindow(): number {
        const config = this.getCurrentConfig();
        return config?.contextWindow || 200000;
    }

    estimateCost(inputTokens: number, outputTokens: number): { cost: number; breakdown: string } {
        const config = this.getCurrentConfig();
        if (!config) {
            return { cost: 0, breakdown: 'Unknown model' };
        }

        const inputCost = (inputTokens / 1_000_000) * config.costPer1MInput;
        const outputCost = (outputTokens / 1_000_000) * config.costPer1MOutput;
        const totalCost = inputCost + outputCost;

        const breakdown = `Input: ${inputTokens.toLocaleString()} tokens ($${inputCost.toFixed(4)}) + Output: ${outputTokens.toLocaleString()} tokens ($${outputCost.toFixed(4)})`;

        return { cost: totalCost, breakdown };
    }

    async selectModelInteractive(): Promise<boolean> {
        const items: vscode.QuickPickItem[] = Array.from(this.models.values()).map(config => ({
            label: config.name,
            description: `Max ${config.maxTokens} tokens, $${config.costPer1MInput}/$${config.costPer1MOutput} per 1M tokens`,
            detail: `Context window: ${config.contextWindow.toLocaleString()} tokens`,
            picked: config.id === `${this.currentModel}-${this.currentMode}`
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a model configuration',
            title: 'Choose AI Model'
        });

        if (selected) {
            const config = Array.from(this.models.values()).find(c => c.name === selected.label);
            if (config) {
                await this.setModel(config.model.split('-20')[0], config.mode);
                return true;
            }
        }

        return false;
    }

    getAvailableModels(): ModelConfig[] {
        return Array.from(this.models.values());
    }

    supportsMode(mode: 'thinking' | 'max'): boolean {
        const configId = `${this.currentModel}-${mode}`;
        return this.models.has(configId);
    }

    updateConfiguration(): void {
        const config = vscode.workspace.getConfiguration('ai-code-agent');
        this.currentModel = config.get('model', 'claude-opus-4');
        this.currentMode = config.get('mode', 'thinking');
    }

    // Token counting utilities
    estimateTokenCount(text: string): number {
        // Rough estimation: ~4 characters per token for English text
        // More accurate counting would require tiktoken or similar
        return Math.ceil(text.length / 4);
    }

    canFitInContext(text: string, reserveTokens: number = 1000): boolean {
        const estimatedTokens = this.estimateTokenCount(text);
        const contextWindow = this.getContextWindow();
        const maxOutput = this.getMaxTokens();
        
        return estimatedTokens + reserveTokens + maxOutput < contextWindow;
    }

    calculateOptimalChunks(text: string, maxChunkTokens: number = 50000): string[] {
        const contextWindow = this.getContextWindow();
        const maxOutput = this.getMaxTokens();
        const safeChunkSize = Math.min(maxChunkTokens, contextWindow - maxOutput - 1000);
        
        const chunks: string[] = [];
        const lines = text.split('\n');
        let currentChunk = '';
        let currentTokens = 0;

        for (const line of lines) {
            const lineTokens = this.estimateTokenCount(line);
            
            if (currentTokens + lineTokens > safeChunkSize && currentChunk) {
                chunks.push(currentChunk);
                currentChunk = line;
                currentTokens = lineTokens;
            } else {
                currentChunk += (currentChunk ? '\n' : '') + line;
                currentTokens += lineTokens;
            }
        }

        if (currentChunk) {
            chunks.push(currentChunk);
        }

        return chunks;
    }

    // Usage tracking
    private usageKey = 'model-usage-stats';

    async trackUsage(inputTokens: number, outputTokens: number, purpose: string): Promise<void> {
        const stats = this.context.globalState.get<any>(this.usageKey, {});
        const modelKey = `${this.currentModel}-${this.currentMode}`;
        
        if (!stats[modelKey]) {
            stats[modelKey] = {
                totalInputTokens: 0,
                totalOutputTokens: 0,
                totalCost: 0,
                purposes: {}
            };
        }

        stats[modelKey].totalInputTokens += inputTokens;
        stats[modelKey].totalOutputTokens += outputTokens;
        
        const { cost } = this.estimateCost(inputTokens, outputTokens);
        stats[modelKey].totalCost += cost;

        if (!stats[modelKey].purposes[purpose]) {
            stats[modelKey].purposes[purpose] = {
                count: 0,
                inputTokens: 0,
                outputTokens: 0
            };
        }

        stats[modelKey].purposes[purpose].count += 1;
        stats[modelKey].purposes[purpose].inputTokens += inputTokens;
        stats[modelKey].purposes[purpose].outputTokens += outputTokens;

        await this.context.globalState.update(this.usageKey, stats);
    }

    async getUsageStats(): Promise<any> {
        return this.context.globalState.get(this.usageKey, {});
    }

    async clearUsageStats(): Promise<void> {
        await this.context.globalState.update(this.usageKey, {});
    }

    async showUsageReport(): Promise<void> {
        const stats = await this.getUsageStats();
        
        if (Object.keys(stats).length === 0) {
            vscode.window.showInformationMessage('No usage data available yet.');
            return;
        }

        let report = '# AI Model Usage Report\n\n';
        let totalCost = 0;

        for (const [modelKey, modelStats] of Object.entries(stats)) {
            const typedModelStats = modelStats as any;
            report += `## ${modelKey}\n\n`;
            report += `- Total Input Tokens: ${typedModelStats.totalInputTokens.toLocaleString()}\n`;
            report += `- Total Output Tokens: ${typedModelStats.totalOutputTokens.toLocaleString()}\n`;
            report += `- Total Cost: $${typedModelStats.totalCost.toFixed(4)}\n\n`;
            
            report += '### Usage by Purpose:\n\n';
            for (const [purpose, purposeStats] of Object.entries(typedModelStats.purposes as any)) {
                const typedPurposeStats = purposeStats as any;
                report += `- **${purpose}**: ${typedPurposeStats.count} calls, ${typedPurposeStats.inputTokens.toLocaleString()} input, ${typedPurposeStats.outputTokens.toLocaleString()} output\n`;
            }
            report += '\n';
            
            totalCost += typedModelStats.totalCost;
        }

        report += `\n**Total Cost Across All Models: $${totalCost.toFixed(4)}**`;

        const doc = await vscode.workspace.openTextDocument({
            content: report,
            language: 'markdown'
        });
        
        await vscode.window.showTextDocument(doc);
    }
}