import Anthropic from '@anthropic-ai/sdk';
import * as vscode from 'vscode';
import { ApiKeyManager } from '../managers/apiKeyManager';
import { ModelManager } from '../managers/modelManager';
import { PreprocessorManager } from '../managers/preprocessor';
import { DiffManager } from '../services/diffManager';
import { FileEditor } from '../services/fileEditor';
import { CodebaseIndexer } from '../services/indexer';
import { ContextManager } from './contextManager';
import { SessionState } from '../core/sessionState';

export interface AgentTask {
    id: string;
    description: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    steps: TaskStep[];
    createdAt: Date;
    completedAt?: Date;
    error?: string;
}

export interface TaskStep {
    id: string;
    description: string;
    type: 'analyze' | 'edit' | 'test' | 'validate';
    status: 'pending' | 'running' | 'completed' | 'failed';
    files?: string[];
    changes?: FileChange[];
    result?: any;
}

export interface FileChange {
    file: string;
    type: 'create' | 'modify' | 'delete';
    diff?: string;
    content?: string;
    approved?: boolean;
}

export class AgentCore {
    private anthropic: Anthropic | null = null;
    private fileEditor: FileEditor;
    private contextManager: ContextManager;
    private sessionState: SessionState;
    private diffManager: DiffManager;
    private currentTask: AgentTask | null = null;
    private taskQueue: AgentTask[] = [];

    constructor(
        private apiKeyManager: ApiKeyManager,
        private modelManager: ModelManager,
        private _indexer: CodebaseIndexer,
        private preprocessorManager: PreprocessorManager
    ) {
        this.fileEditor = new FileEditor();
        this.contextManager = new ContextManager(this._indexer, preprocessorManager);
        this.sessionState = new SessionState();
        this.diffManager = new DiffManager();
        
        this.initializeAnthropic();
    }

    private async initializeAnthropic() {
        const apiKey = await this.apiKeyManager.getApiKey();
        if (apiKey) {
            this.anthropic = new Anthropic({ apiKey });
        }
    }

    async executeTask(description: string): Promise<void> {
        if (!this.anthropic) {
            const apiKey = await this.apiKeyManager.getApiKey();
            if (!apiKey) {
                vscode.window.showErrorMessage('Please set your Anthropic API key first');
                await vscode.commands.executeCommand('ai-code-agent.setApiKey');
                return;
            }
            this.anthropic = new Anthropic({ apiKey });
        }

        // Create new task
        const task: AgentTask = {
            id: this.generateId(),
            description,
            status: 'pending',
            steps: [],
            createdAt: new Date()
        };

        this.currentTask = task;
        this.taskQueue.push(task);

        try {
            // Show progress
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Executing: ${description}`,
                cancellable: true
            }, async (progress, token) => {
                // Step 1: Analyze and plan
                progress.report({ increment: 10, message: 'Analyzing request...' });
                const plan = await this.planTask(task, token);
                
                if (token.isCancellationRequested) {
                    throw new Error('Task cancelled');
                }

                // Step 2: Gather context
                progress.report({ increment: 20, message: 'Gathering context...' });
                const context = await this.gatherContext(plan, token);

                // Step 3: Execute steps
                let increment = 70 / plan.steps.length;
                for (const step of plan.steps) {
                    if (token.isCancellationRequested) {
                        throw new Error('Task cancelled');
                    }

                    progress.report({ 
                        increment, 
                        message: `Executing: ${step.description}` 
                    });
                    
                    await this.executeStep(task, step, context);
                }

                // Step 4: Validate and finalize
                progress.report({ increment: 0, message: 'Validating changes...' });
                await this.validateAndFinalize(task);
            });

            task.status = 'completed';
            task.completedAt = new Date();
            vscode.window.showInformationMessage(`Task completed: ${description}`);
            
        } catch (error) {
            task.status = 'failed';
            task.error = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Task failed: ${task.error}`);
        }

        this.sessionState.addTask(task);
        this.currentTask = null;
    }

    private async planTask(task: AgentTask, _token: vscode.CancellationToken): Promise<any> {
        // Use preprocessor to analyze codebase structure
        const codebaseAnalysis = await this.preprocessorManager.analyzeCodebase();
        
        // Use Claude to create execution plan
        const planningPrompt = `
You are an AI coding agent. Analyze this task and create a detailed execution plan.

Task: ${task.description}

Codebase Structure:
${JSON.stringify(codebaseAnalysis, null, 2)}

Create a step-by-step plan with:
1. Analysis steps to understand the current code
2. Specific files to read and modify
3. Validation steps to ensure correctness
4. Order of operations

Return a JSON plan with this structure:
{
  "summary": "Brief summary of the plan",
  "estimatedFiles": ["list", "of", "files"],
  "steps": [
    {
      "type": "analyze|edit|test|validate",
      "description": "What this step does",
      "files": ["files to process"],
      "details": {}
    }
  ]
}`;

        const response = await this.callClaude(planningPrompt, 'planning');
        const plan = JSON.parse(response);
        
        // Store plan in task
        task.steps = plan.steps.map((step: any) => ({
            id: this.generateId(),
            ...step,
            status: 'pending'
        }));

        return plan;
    }

    private async gatherContext(plan: any, _token: vscode.CancellationToken): Promise<any> {
        // Use preprocessor to gather and rank relevant context
        const relevantFiles = await this.preprocessorManager.rankRelevantFiles(
            plan.estimatedFiles,
            plan.summary
        );

        // Chunk and summarize large files
        const context = await this.contextManager.prepareContext(
            relevantFiles,
            this.modelManager.getMaxTokens()
        );

        return context;
    }

    private async executeStep(_task: AgentTask, step: TaskStep, context: any): Promise<void> {
        step.status = 'running';
        
        try {
            switch (step.type) {
                case 'analyze':
                    await this.executeAnalyzeStep(step, context);
                    break;
                case 'edit':
                    await this.executeEditStep(step, context);
                    break;
                case 'test':
                    await this.executeTestStep(step, context);
                    break;
                case 'validate':
                    await this.executeValidateStep(step, context);
                    break;
            }
            
            step.status = 'completed';
        } catch (error) {
            step.status = 'failed';
            throw error;
        }
    }

    private async executeEditStep(step: TaskStep, context: any): Promise<void> {
        const editPrompt = `
You are an AI coding agent performing a specific edit operation.

Step: ${step.description}

Context:
${JSON.stringify(context, null, 2)}

Generate the exact code changes needed. For each file:
1. Provide the complete new content
2. Explain what changed and why
3. Ensure the code is syntactically correct

Return JSON:
{
  "changes": [
    {
      "file": "path/to/file",
      "type": "modify",
      "content": "complete new file content",
      "explanation": "what changed and why"
    }
  ]
}`;

        const response = await this.callClaude(editPrompt, 'editing');
        const { changes } = JSON.parse(response);

        // Create diffs and preview
        const fileChanges: FileChange[] = [];
        for (const change of changes) {
            const diff = await this.diffManager.createDiff(change.file, change.content);
            fileChanges.push({
                file: change.file,
                type: change.type,
                diff,
                content: change.content,
                approved: false
            });
        }

        // Show preview and get approval
        const approved = await this.showChangesPreview(fileChanges);
        
        if (approved) {
            // Apply changes
            for (const change of fileChanges) {
                if (change.approved) {
                    await this.fileEditor.applyChange(change);
                }
            }
        }

        step.changes = fileChanges;
    }

    private async showChangesPreview(changes: FileChange[]): Promise<boolean> {
        // Create a preview document
        const previewContent = changes.map(change => 
            `File: ${change.file}\n${change.diff}\n${'='.repeat(80)}\n`
        ).join('\n');

        const doc = await vscode.workspace.openTextDocument({
            content: previewContent,
            language: 'diff'
        });
        
        await vscode.window.showTextDocument(doc);

        // Ask for approval
        const result = await vscode.window.showInformationMessage(
            `Apply ${changes.length} file changes?`,
            { modal: true },
            'Apply All',
            'Review Each',
            'Cancel'
        );

        if (result === 'Apply All') {
            changes.forEach(c => c.approved = true);
            return true;
        } else if (result === 'Review Each') {
            for (const change of changes) {
                const approve = await vscode.window.showInformationMessage(
                    `Apply changes to ${change.file}?`,
                    { modal: true },
                    'Yes',
                    'No'
                );
                change.approved = approve === 'Yes';
            }
            return true;
        }

        return false;
    }

    private async callClaude(prompt: string, purpose: string): Promise<string> {
        if (!this.anthropic) {
            throw new Error('Anthropic client not initialized');
        }

        const model = this.modelManager.getCurrentModel();
        const mode = this.modelManager.getCurrentMode();

        try {
            // Track token usage
            const startTokens = this.estimateTokens(prompt);
            
            const response = await this.anthropic.messages.create({
                model: model,
                max_tokens: this.modelManager.getMaxTokens(),
                messages: [{
                    role: 'user',
                    content: prompt
                }],
                // Add mode-specific parameters
                ...(mode === 'thinking' ? { temperature: 0.3 } : { temperature: 0.7 })
            });

            const responseText = response.content[0].type === 'text' 
                ? response.content[0].text 
                : '';

            // Track usage
            const usage = {
                promptTokens: startTokens,
                completionTokens: this.estimateTokens(responseText),
                purpose,
                model,
                mode
            };
            
            this.sessionState.addUsage(usage);

            return responseText;
        } catch (error) {
            if (error instanceof Error && error.message.includes('rate_limit')) {
                await this.delay(60000); // Wait 1 minute
                return this.callClaude(prompt, purpose); // Retry
            }
            throw error;
        }
    }

    private async executeAnalyzeStep(step: TaskStep, _context: any): Promise<void> {
        // Implementation for analyze steps
        const analysis = await this.preprocessorManager.analyzeFiles(step.files || []);
        step.result = analysis;
    }

    private async executeTestStep(_step: TaskStep, _context: any): Promise<void> {
        // Implementation for test steps
        const terminal = vscode.window.createTerminal('AI Agent Tests');
        terminal.sendText('npm test');
        terminal.show();
    }

    private async executeValidateStep(step: TaskStep, _context: any): Promise<void> {
        // Implementation for validation steps
        const diagnostics = vscode.languages.getDiagnostics();
        step.result = { diagnostics: diagnostics.length };
    }

    private async validateAndFinalize(task: AgentTask): Promise<void> {
        // Final validation and cleanup
        const allChanges = task.steps
            .filter(s => s.changes)
            .flatMap(s => s.changes || []);

        // Create summary report
        const report = {
            type: 'task' as const,
            data: {
                task: task.description,
                filesModified: [...new Set(allChanges.map(c => c.file))],
                totalChanges: allChanges.length,
                status: task.status,
                duration: task.completedAt 
                    ? task.completedAt.getTime() - task.createdAt.getTime() 
                    : 0
            }
        };

        this.sessionState.addReport(report);
    }

    private estimateTokens(text: string): number {
        // Simple estimation: ~4 characters per token
        return Math.ceil(text.length / 4);
    }

    private generateId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getSessionState(): SessionState {
        return this.sessionState;
    }

    getCurrentTask(): AgentTask | null {
        return this.currentTask;
    }

    getTaskHistory(): AgentTask[] {
        return this.taskQueue;
    }

    dispose() {
        this.sessionState.save();
    }
}