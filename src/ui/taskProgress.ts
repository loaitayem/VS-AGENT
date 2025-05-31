import * as vscode from 'vscode';
import * as path from 'path';
import { AgentCore, AgentTask, TaskStep } from '../core/core';

export class TaskProgressProvider implements vscode.TreeDataProvider<TaskTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TaskTreeItem | undefined | null | void> = 
        new vscode.EventEmitter<TaskTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<TaskTreeItem | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    private refreshInterval: NodeJS.Timeout | null = null;

    constructor(
        // @ts-ignore: Parameter is required for future extensibility
        private _context: vscode.ExtensionContext,
        private agentCore: AgentCore
    ) {
        // Auto-refresh while tasks are running
        this.startAutoRefresh();

        // Register commands
        this.registerCommands();
    }

    private registerCommands() {
        vscode.commands.registerCommand('ai-agent-tasks.refresh', () => this.refresh());
        vscode.commands.registerCommand('ai-agent-tasks.viewDetails', (item: TaskTreeItem) => 
            this.viewTaskDetails(item));
        vscode.commands.registerCommand('ai-agent-tasks.cancelTask', (item: TaskTreeItem) => 
            this.cancelTask(item));
        vscode.commands.registerCommand('ai-agent-tasks.viewChanges', (item: TaskTreeItem) => 
            this.viewChanges(item));
        vscode.commands.registerCommand('ai-agent-tasks.exportReport', (item: TaskTreeItem) => 
            this.exportReport(item));
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TaskTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TaskTreeItem): Thenable<TaskTreeItem[]> {
        if (!element) {
            // Root level - show current task and recent tasks
            return Promise.resolve(this.getRootItems());
        } else if (element.contextValue === 'task') {
            // Task level - show steps
            return Promise.resolve(this.getTaskSteps(element.task!));
        } else if (element.contextValue === 'step') {
            // Step level - show details
            return Promise.resolve(this.getStepDetails(element.step!));
        }
        
        return Promise.resolve([]);
    }

    private getRootItems(): TaskTreeItem[] {
        const items: TaskTreeItem[] = [];
        
        // Current task
        const currentTask = this.agentCore.getCurrentTask();
        if (currentTask) {
            items.push(new TaskTreeItem(
                currentTask.description,
                currentTask,
                vscode.TreeItemCollapsibleState.Expanded,
                'task',
                true
            ));
        }

        // Recent tasks
        const recentTasks = this.agentCore.getTaskHistory()
            .filter(t => t !== currentTask)
            .slice(-5)
            .reverse();

        for (const task of recentTasks) {
            items.push(new TaskTreeItem(
                task.description,
                task,
                vscode.TreeItemCollapsibleState.Collapsed,
                'task',
                false
            ));
        }

        return items;
    }

    private getTaskSteps(task: AgentTask): TaskTreeItem[] {
        return task.steps.map(step => {
            const hasDetails = step.changes && step.changes.length > 0;
            return new TaskTreeItem(
                step.description,
                task,
                hasDetails ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                'step',
                false,
                step
            );
        });
    }

    private getStepDetails(step: TaskStep): TaskTreeItem[] {
        const items: TaskTreeItem[] = [];

        // Show files changed
        if (step.changes && step.changes.length > 0) {
            items.push(new TaskTreeItem(
                `Files Modified (${step.changes.length})`,
                undefined,
                vscode.TreeItemCollapsibleState.Expanded,
                'section'
            ));

            for (const change of step.changes) {
                const filename = path.basename(change.file);
                            
                items.push(new TaskTreeItem(
                    filename,
                    undefined,
                    vscode.TreeItemCollapsibleState.None,
                    'file',
                    false,
                    step,
                    change
                ));
            }
        }

        // Show validation results
        if (step.result) {
            items.push(new TaskTreeItem(
                'Validation Results',
                undefined,
                vscode.TreeItemCollapsibleState.None,
                'result'
            ));
        }

        return items;
    }

    private async viewTaskDetails(item: TaskTreeItem) {
        if (!item.task) return;

        const panel = vscode.window.createWebviewPanel(
            'taskDetails',
            `Task: ${item.task.description}`,
            vscode.ViewColumn.One,
            { enableScripts: true }
        );

        panel.webview.html = this.getTaskDetailsHtml(item.task);
    }

    private getTaskDetailsHtml(task: AgentTask): string {
        const duration = task.completedAt 
            ? ((task.completedAt.getTime() - task.createdAt.getTime()) / 1000).toFixed(1)
            : 'In Progress';

        const filesModified = new Set<string>();
        task.steps.forEach(step => {
            if (step.changes) {
                step.changes.forEach(change => filesModified.add(change.file));
            }
        });

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Task Details</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 20px;
                    line-height: 1.6;
                }
                h1, h2 { margin-top: 0; }
                .status {
                    display: inline-block;
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-weight: bold;
                    margin-left: 10px;
                }
                .status.completed { 
                    background-color: var(--vscode-testing-passBorder);
                    color: var(--vscode-testing-passBackground);
                }
                .status.failed { 
                    background-color: var(--vscode-testing-errorBorder);
                    color: var(--vscode-testing-errorBackground);
                }
                .status.running { 
                    background-color: var(--vscode-testing-runBorder);
                    color: var(--vscode-testing-runBackground);
                }
                .info-grid {
                    display: grid;
                    grid-template-columns: auto 1fr;
                    gap: 10px;
                    margin: 20px 0;
                }
                .info-label {
                    font-weight: bold;
                    opacity: 0.8;
                }
                .step {
                    margin: 10px 0;
                    padding: 10px;
                    border-left: 3px solid var(--vscode-panel-border);
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                }
                .step.completed { border-left-color: var(--vscode-testing-passBorder); }
                .step.failed { border-left-color: var(--vscode-testing-errorBorder); }
                .step.running { border-left-color: var(--vscode-testing-runBorder); }
                .file-list {
                    list-style: none;
                    padding: 0;
                }
                .file-list li {
                    padding: 5px 0;
                    display: flex;
                    align-items: center;
                    gap: 5px;
                }
                .icon {
                    width: 16px;
                    height: 16px;
                    display: inline-block;
                }
                .error {
                    background-color: var(--vscode-inputValidation-errorBackground);
                    border: 1px solid var(--vscode-inputValidation-errorBorder);
                    padding: 10px;
                    margin: 10px 0;
                    border-radius: 4px;
                }
            </style>
        </head>
        <body>
            <h1>${task.description} 
                <span class="status ${task.status}">${task.status.toUpperCase()}</span>
            </h1>

            <div class="info-grid">
                <span class="info-label">Task ID:</span>
                <span>${task.id}</span>
                
                <span class="info-label">Created:</span>
                <span>${task.createdAt.toLocaleString()}</span>
                
                <span class="info-label">Duration:</span>
                <span>${duration}${duration !== 'In Progress' ? 's' : ''}</span>
                
                <span class="info-label">Files Modified:</span>
                <span>${filesModified.size}</span>
                
                <span class="info-label">Steps:</span>
                <span>${task.steps.filter(s => s.status === 'completed').length}/${task.steps.length} completed</span>
            </div>

            ${task.error ? `<div class="error"><strong>Error:</strong> ${task.error}</div>` : ''}

            <h2>Steps</h2>
            ${task.steps.map((step, index) => `
                <div class="step ${step.status}">
                    <strong>${index + 1}. ${step.description}</strong>
                    <div>Status: ${step.status}</div>
                    ${step.files ? `<div>Files: ${step.files.join(', ')}</div>` : ''}
                </div>
            `).join('')}

            <h2>Modified Files</h2>
            <ul class="file-list">
                ${Array.from(filesModified).map(file => `
                    <li>
                        <span class="icon">📄</span>
                        <span>${file}</span>
                    </li>
                `).join('')}
            </ul>
        </body>
        </html>`;
    }

    private async cancelTask(item: TaskTreeItem) {
        if (!item.task || item.task.status !== 'running') return;

        const confirm = await vscode.window.showWarningMessage(
            `Cancel task "${item.task.description}"?`,
            { modal: true },
            'Cancel Task',
            'Continue'
        );

        if (confirm === 'Cancel Task') {
            // Implement task cancellation logic
            vscode.window.showInformationMessage('Task cancellation requested');
        }
    }

    private async viewChanges(item: TaskTreeItem) {
        if (!item.step?.changes) return;

        for (const change of item.step.changes) {
            if (change.diff) {
                const doc = await vscode.workspace.openTextDocument({
                    content: change.diff,
                    language: 'diff'
                });
                await vscode.window.showTextDocument(doc);
            }
        }
    }

    private async exportReport(item: TaskTreeItem) {
        if (!item.task) return;

        const sessionState = this.agentCore.getSessionState();
        const report = await sessionState.exportSession('markdown');

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`task-report-${item.task.id}.md`),
            filters: {
                'Markdown': ['md'],
                'JSON': ['json']
            }
        });

        if (uri) {
            const encoder = new TextEncoder();
            await vscode.workspace.fs.writeFile(uri, encoder.encode(report));
            vscode.window.showInformationMessage('Report exported successfully');
        }
    }

    private startAutoRefresh() {
        this.refreshInterval = setInterval(() => {
            const currentTask = this.agentCore.getCurrentTask();
            if (currentTask && currentTask.status === 'running') {
                this.refresh();
            }
        }, 1000); // Refresh every second while tasks are running
    }

    dispose() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
    }
}

class TaskTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly task: AgentTask | undefined,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly isCurrent: boolean = false,
        public readonly step?: TaskStep,
        public readonly change?: any
    ) {
        super(label, collapsibleState);

        this.tooltip = this.getTooltip();
        this.iconPath = this.getIcon();
        this.command = this.getCommand();
        this.description = this.getDescription();
    }

    private getTooltip(): string {
        if (this.task) {
            return `${this.task.description}\nStatus: ${this.task.status}\nCreated: ${this.task.createdAt.toLocaleString()}`;
        } else if (this.step) {
            return `${this.step.description}\nType: ${this.step.type}\nStatus: ${this.step.status}`;
        }
        return this.label;
    }

    private getIcon(): vscode.ThemeIcon | undefined {
        if (this.contextValue === 'task') {
            if (this.task?.status === 'completed') {
                return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
            } else if (this.task?.status === 'failed') {
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
            } else if (this.task?.status === 'running') {
                return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('testing.iconQueued'));
            }
            return new vscode.ThemeIcon('circle-outline');
        } else if (this.contextValue === 'step') {
            const iconMap = {
                'analyze': 'search',
                'edit': 'edit',
                'test': 'beaker',
                'validate': 'verified',
                'review': 'eye'
            };
            return new vscode.ThemeIcon(iconMap[this.step?.type as keyof typeof iconMap] || 'circle-small');
        } else if (this.contextValue === 'file') {
            const iconMap = {
                'create': 'add',
                'modify': 'edit',
                'delete': 'trash'
            };
            return new vscode.ThemeIcon(iconMap[this.change?.type as keyof typeof iconMap] || 'file');
        }
        return undefined;
    }

    private getCommand(): vscode.Command | undefined {
        if (this.contextValue === 'task') {
            return {
                command: 'ai-agent-tasks.viewDetails',
                title: 'View Details',
                arguments: [this]
            };
        } else if (this.contextValue === 'file' && this.change) {
            return {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [vscode.Uri.file(this.change.file)]
            };
        }
        return undefined;
    }

    private getDescription(): string {
        if (this.contextValue === 'task' && this.task) {
            if (this.isCurrent) {
                return '(current)';
            }
            const time = this.task.completedAt || this.task.createdAt;
            return time.toLocaleTimeString();
        } else if (this.contextValue === 'step' && this.step) {
            return this.step.status;
        } else if (this.contextValue === 'file' && this.change) {
            return this.change.type;
        }
        return '';
    }
}