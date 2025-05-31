import * as vscode from 'vscode';
import { AgentCore } from '../core/core';
import { SessionInfo, SessionData } from '../core/sessionState';

export class SessionHistoryProvider implements vscode.TreeDataProvider<HistoryItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<HistoryItem | undefined | null | void> = 
        new vscode.EventEmitter<HistoryItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<HistoryItem | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    private sessions: SessionInfo[] = [];

    constructor(
        private context: vscode.ExtensionContext,
        private agentCore: AgentCore
    ) {
        this.loadSessions();
        this.registerCommands();

        // Listen for session events
        this.agentCore.getSessionState().onSessionEvent((_event: any) => {
            if (_event && (_event.type === 'session-ended' || _event.type === 'session-started')) {
                this.loadSessions();
            }
        });
    }

    private registerCommands() {
        vscode.commands.registerCommand('ai-agent-history.refresh', () => this.refresh());
        vscode.commands.registerCommand('ai-agent-history.viewSession', (item: HistoryItem) => 
            this.viewSession(item));
        vscode.commands.registerCommand('ai-agent-history.exportSession', (item: HistoryItem) => 
            this.exportSession(item));
        vscode.commands.registerCommand('ai-agent-history.deleteSession', (item: HistoryItem) => 
            this.deleteSession(item));
        vscode.commands.registerCommand('ai-agent-history.compareSession', (item: HistoryItem) => 
            this.compareSession(item));
        vscode.commands.registerCommand('ai-agent-history.showUsageStats', () => 
            this.showUsageStats());
    }

    refresh(): void {
        this.loadSessions();
    }

    private async loadSessions() {
        this.sessions = await this.agentCore.getSessionState().listSessions();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: HistoryItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: HistoryItem): Promise<HistoryItem[]> {
        if (!element) {
            // Root level - show sessions grouped by date
            return this.getSessionGroups();
        } else if (element.type === 'group') {
            // Date group - show sessions for that date
            return this.getSessionsForDate(element.date!);
        } else if (element.type === 'session') {
            // Session - show summary items
            return this.getSessionSummary(element.sessionId!);
        }
        
        return [];
    }

    private getSessionGroups(): HistoryItem[] {
        const groups = new Map<string, SessionInfo[]>();
        
        // Group sessions by date
        for (const session of this.sessions) {
            const dateKey = session.startTime.toLocaleDateString();
            if (!groups.has(dateKey)) {
                groups.set(dateKey, []);
            }
            groups.get(dateKey)!.push(session);
        }

        // Create group items
        const items: HistoryItem[] = [];
        const sortedDates = Array.from(groups.keys()).sort((a, b) => 
            new Date(b).getTime() - new Date(a).getTime()
        );

        for (const date of sortedDates) {
            const sessions = groups.get(date)!;
            const label = this.getDateLabel(new Date(date));
            
            items.push(new HistoryItem(
                label,
                'group',
                vscode.TreeItemCollapsibleState.Expanded,
                new Date(date),
                undefined,
                `${sessions.length} session${sessions.length !== 1 ? 's' : ''}`
            ));
        }

        return items;
    }

    private getDateLabel(date: Date): string {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (date.toDateString() === today.toDateString()) {
            return 'Today';
        } else if (date.toDateString() === yesterday.toDateString()) {
            return 'Yesterday';
        } else {
            return date.toLocaleDateString(undefined, { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'short', 
                day: 'numeric' 
            });
        }
    }

    private getSessionsForDate(date: Date): HistoryItem[] {
        const dateStr = date.toLocaleDateString();
        const sessions = this.sessions.filter(s => 
            s.startTime.toLocaleDateString() === dateStr
        );

        return sessions.map(session => {
            const duration = session.endTime 
                ? (session.endTime.getTime() - session.startTime.getTime()) / 1000
                : 0;
            
            const timeStr = session.startTime.toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit'
            });

            return new HistoryItem(
                `${timeStr} - ${session.taskCount} task${session.taskCount !== 1 ? 's' : ''}`,
                'session',
                vscode.TreeItemCollapsibleState.Collapsed,
                undefined,
                session.id,
                this.formatDuration(duration)
            );
        });
    }

    private async getSessionSummary(sessionId: string): Promise<HistoryItem[]> {
        const sessionData = await this.agentCore.getSessionState().loadSession(sessionId);
        if (!sessionData) return [];

        const items: HistoryItem[] = [];

        // Calculate stats
        const totalTokens = sessionData.usage.reduce((sum: any, u: any) => 
            sum + u.promptTokens + u.completionTokens, 0
        );
        const totalCost = sessionData.usage.reduce((sum: any, u: any) => sum + u.cost, 0);
        const filesModified = new Set<string>();        sessionData.tasks.forEach((t: any) =>
            t.filesModified.forEach((f: any) => filesModified.add(f))
        );

        // Add summary items
        items.push(
            new HistoryItem(
                `Tasks: ${sessionData.tasks.length}`,
                'stat',
                vscode.TreeItemCollapsibleState.None,
                undefined,
                sessionId,
                `${sessionData.tasks.filter(t => t.task.status === 'completed').length} completed`
            ),
            new HistoryItem(
                `Files Modified: ${filesModified.size}`,
                'stat',
                vscode.TreeItemCollapsibleState.None,
                undefined,
                sessionId
            ),
            new HistoryItem(
                `Tokens Used: ${totalTokens.toLocaleString()}`,
                'stat',
                vscode.TreeItemCollapsibleState.None,
                undefined,
                sessionId,
                `Cost: $${totalCost.toFixed(4)}`
            )
        );

        // Add model usage breakdown
        const modelUsage = new Map<string, number>();
        sessionData.usage.forEach(u => {
            const key = `${u.model}-${u.mode}`;
            modelUsage.set(key, (modelUsage.get(key) || 0) + u.promptTokens + u.completionTokens);
        });

        if (modelUsage.size > 0) {
            items.push(new HistoryItem(
                'Model Usage',
                'section',
                vscode.TreeItemCollapsibleState.None,
                undefined,
                sessionId
            ));

            for (const [model, tokens] of modelUsage) {
                items.push(new HistoryItem(
                    `  ${model}: ${tokens.toLocaleString()} tokens`,
                    'stat',
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    sessionId
                ));
            }
        }

        return items;
    }

    private formatDuration(seconds: number): string {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else if (minutes > 0) {
            return `${minutes}m`;
        } else {
            return '<1m';
        }
    }

    private async viewSession(item: HistoryItem) {
        if (!item.sessionId) return;

        const sessionData = await this.agentCore.getSessionState().loadSession(item.sessionId);
        if (!sessionData) {
            vscode.window.showErrorMessage('Session data not found');
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'sessionView',
            `Session: ${item.sessionId}`,
            vscode.ViewColumn.One,
            { enableScripts: true }
        );

        panel.webview.html = await this.getSessionViewHtml(sessionData);
    }

    private async getSessionViewHtml(session: SessionData): Promise<string> {
        const duration = session.endTime 
            ? (session.endTime.getTime() - session.startTime.getTime()) / 1000
            : 0;

        const totalTokens = session.usage.reduce((sum, u) => 
            sum + u.promptTokens + u.completionTokens, 0
        );
        const totalCost = session.usage.reduce((sum, u) => sum + u.cost, 0);

        const filesModified = new Set<string>();
        session.tasks.forEach(t => 
            t.filesModified.forEach(f => filesModified.add(f))
        );

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Session Details</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 20px;
                    line-height: 1.6;
                }
                .header {
                    border-bottom: 1px solid var(--vscode-panel-border);
                    padding-bottom: 20px;
                    margin-bottom: 20px;
                }
                .stats {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 20px;
                    margin: 20px 0;
                }
                .stat-card {
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                    padding: 15px;
                    border-radius: 4px;
                }
                .stat-value {
                    font-size: 24px;
                    font-weight: bold;
                    margin: 5px 0;
                }
                .stat-label {
                    opacity: 0.8;
                    font-size: 14px;
                }
                .task-list {
                    margin: 20px 0;
                }
                .task-item {
                    margin: 10px 0;
                    padding: 15px;
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                    border-radius: 4px;
                    border-left: 3px solid var(--vscode-panel-border);
                }
                .task-item.completed {
                    border-left-color: var(--vscode-testing-passBorder);
                }
                .task-item.failed {
                    border-left-color: var(--vscode-testing-errorBorder);
                }
                .model-usage {
                    margin: 20px 0;
                }
                .usage-bar {
                    display: flex;
                    height: 30px;
                    border-radius: 4px;
                    overflow: hidden;
                    margin: 10px 0;
                }
                .usage-segment {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-size: 12px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin: 10px 0;
                }
                th, td {
                    text-align: left;
                    padding: 8px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                th {
                    font-weight: bold;
                    opacity: 0.8;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>Session ${session.id}</h1>
                <p>
                    <strong>Started:</strong> ${new Date(session.startTime).toLocaleString()}<br>
                    <strong>Duration:</strong> ${this.formatDuration(duration)}<br>
                    <strong>Model:</strong> ${session.settings.model} (${session.settings.mode} mode)
                </p>
            </div>

            <div class="stats">
                <div class="stat-card">
                    <div class="stat-label">Tasks</div>
                    <div class="stat-value">${session.tasks.length}</div>
                    <div class="stat-label">${session.tasks.filter(t => t.task.status === 'completed').length} completed</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Files Modified</div>
                    <div class="stat-value">${filesModified.size}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Tokens Used</div>
                    <div class="stat-value">${totalTokens.toLocaleString()}</div>
                    <div class="stat-label">$${totalCost.toFixed(4)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">API Calls</div>
                    <div class="stat-value">${session.usage.length}</div>
                </div>
            </div>

            <h2>Tasks</h2>
            <div class="task-list">
                ${session.tasks.map(task => `
                    <div class="task-item ${task.task.status}">
                        <strong>${task.task.description}</strong>
                        <div style="margin-top: 5px; opacity: 0.8;">
                            Status: ${task.task.status} | 
                            Duration: ${task.endTime ? this.formatDuration((task.endTime.getTime() - task.startTime.getTime()) / 1000) : 'N/A'} |
                            Files: ${task.filesModified.length} |
                            Tokens: ${task.tokenUsage.total.toLocaleString()}
                        </div>
                    </div>
                `).join('')}
            </div>

            <h2>Model Usage</h2>
            <div class="model-usage">
                ${this.renderModelUsageChart(session)}
            </div>

            <h2>Token Usage by Purpose</h2>
            <table>
                <tr>
                    <th>Purpose</th>
                    <th>Calls</th>
                    <th>Tokens</th>
                    <th>Cost</th>
                </tr>
                ${this.renderUsageTable(session)}
            </table>
        </body>
        </html>`;
    }

    private renderModelUsageChart(session: SessionData): string {
        const modelUsage = new Map<string, { tokens: number; color: string }>();
        const colors = ['#007ACC', '#5C2D91', '#2EA043', '#DA3B01', '#FFA500'];
        let colorIndex = 0;

        session.usage.forEach(u => {
            const key = `${u.model}-${u.mode}`;
            if (!modelUsage.has(key)) {
                modelUsage.set(key, { 
                    tokens: 0, 
                    color: colors[colorIndex++ % colors.length] 
                });
            }
            modelUsage.get(key)!.tokens += u.promptTokens + u.completionTokens;
        });

        const totalTokens = Array.from(modelUsage.values()).reduce((sum, m) => sum + m.tokens, 0);

        return `
            <div class="usage-bar">
                ${Array.from(modelUsage.entries()).map(([model, data]) => {
                    const percentage = (data.tokens / totalTokens) * 100;
                    return `
                        <div class="usage-segment" style="background-color: ${data.color}; width: ${percentage}%;">
                            ${percentage > 10 ? `${model} (${percentage.toFixed(1)}%)` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
            <div style="display: flex; gap: 20px; flex-wrap: wrap; margin-top: 10px;">
                ${Array.from(modelUsage.entries()).map(([model, data]) => `
                    <div style="display: flex; align-items: center; gap: 5px;">
                        <div style="width: 16px; height: 16px; background-color: ${data.color}; border-radius: 2px;"></div>
                        <span>${model}: ${data.tokens.toLocaleString()} tokens</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    private renderUsageTable(session: SessionData): string {
        const purposeUsage = new Map<string, { calls: number; tokens: number; cost: number }>();

        session.usage.forEach(u => {
            if (!purposeUsage.has(u.purpose)) {
                purposeUsage.set(u.purpose, { calls: 0, tokens: 0, cost: 0 });
            }
            const pu = purposeUsage.get(u.purpose)!;
            pu.calls += 1;
            pu.tokens += u.promptTokens + u.completionTokens;
            pu.cost += u.cost;
        });

        return Array.from(purposeUsage.entries())
            .sort((a, b) => b[1].tokens - a[1].tokens)
            .map(([purpose, data]) => `
                <tr>
                    <td>${purpose}</td>
                    <td>${data.calls}</td>
                    <td>${data.tokens.toLocaleString()}</td>
                    <td>$${data.cost.toFixed(4)}</td>
                </tr>
            `).join('');
    }

    private async exportSession(item: HistoryItem) {
        if (!item.sessionId) return;

        const formats = ['Markdown Report', 'JSON Data'];
        const selected = await vscode.window.showQuickPick(formats, {
            placeHolder: 'Select export format'
        });

        if (!selected) return;

        const sessionState = this.agentCore.getSessionState();
        const format = selected === 'JSON Data' ? 'json' : 'markdown';
        const extension = format === 'json' ? 'json' : 'md';

        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`session-${item.sessionId}.${extension}`),
            filters: {
                [selected]: [extension]
            }
        });

        if (uri) {
            // Load the specific session
            const sessionData = await sessionState.loadSession(item.sessionId);
            if (!sessionData) {
                vscode.window.showErrorMessage('Session data not found');
                return;
            }

            const content = format === 'json' 
                ? JSON.stringify(sessionData, null, 2)
                : this.generateMarkdownReport(sessionData);

            const encoder = new TextEncoder();
            await vscode.workspace.fs.writeFile(uri, encoder.encode(content));
            vscode.window.showInformationMessage('Session exported successfully');
        }
    }

    private generateMarkdownReport(_session: SessionData): string {
        // Use the session state's report generation
        const sessionState = this.agentCore.getSessionState();
        return sessionState['generateMarkdownReport'](sessionState.getSessionSummary());
    }

    private async deleteSession(_item: HistoryItem) {
        // Implementation would require adding delete functionality to SessionState
        vscode.window.showInformationMessage('Delete session not yet implemented');
    }

    private async compareSession(_item: HistoryItem) {
        // Allow comparing two sessions
        vscode.window.showInformationMessage('Session comparison not yet implemented');
    }

    private async showUsageStats() {
        const modelManager = this.context.globalState.get('modelManager');
        if (modelManager && typeof modelManager === 'object' && 'showUsageReport' in modelManager) {
            await (modelManager as any).showUsageReport();
        }
    }
}

class HistoryItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly type: 'group' | 'session' | 'stat' | 'section',
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly date?: Date,
        public readonly sessionId?: string,
        public readonly description?: string
    ) {
        super(label, collapsibleState);

        this.tooltip = this.getTooltip();
        this.iconPath = this.getIcon();
        this.contextValue = this.type;
        
        if (this.type === 'session') {
            this.command = {
                command: 'ai-agent-history.viewSession',
                title: 'View Session',
                arguments: [this]
            };
        }
    }

    private getTooltip(): string {
        if (this.type === 'group' && this.date) {
            return `Sessions from ${this.date.toLocaleDateString()}`;
        } else if (this.type === 'session') {
            return `Session ID: ${this.sessionId}`;
        }
        return this.label;
    }

    private getIcon(): vscode.ThemeIcon | undefined {
        const iconMap = {
            'group': 'calendar',
            'session': 'history',
            'stat': 'graph',
            'section': 'folder'
        };
        return new vscode.ThemeIcon(iconMap[this.type] || 'circle-outline');
    }
}