import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { AgentTask } from './core';

export interface SessionData {
    id: string;
    startTime: Date;
    endTime?: Date;
    tasks: TaskRecord[];
    usage: UsageRecord[];
    reports: Report[];
    settings: SessionSettings;
}

export interface TaskRecord {
    task: AgentTask;
    startTime: Date;
    endTime?: Date;
    tokenUsage: TokenUsage;
    filesModified: string[];
    errors: string[];
}

export interface UsageRecord {
    timestamp: Date;
    model: string;
    mode: string;
    purpose: string;
    promptTokens: number;
    completionTokens: number;
    cost: number;
}

export interface TokenUsage {
    total: number;
    byPurpose: { [key: string]: number };
    byModel: { [key: string]: number };
}

export interface Report {
    timestamp: Date;
    type: 'task' | 'session' | 'error' | 'performance';
    data: any;
}

export interface SessionSettings {
    model: string;
    mode: string;
    maxTokens: number;
    preprocessorModel: string;
}

export class SessionState {
    private currentSession: SessionData;
    private sessionPath: string = '';
    private autoSaveInterval: NodeJS.Timeout | null = null;
    private eventEmitter = new vscode.EventEmitter<SessionEvent>();
    
    public readonly onSessionEvent = this.eventEmitter.event;

    constructor() {
        this.currentSession = this.createNewSession();
        this.startAutoSave();
    }

    private createNewSession(): SessionData {
        return {
            id: this.generateSessionId(),
            startTime: new Date(),
            tasks: [],
            usage: [],
            reports: [],
            settings: this.captureCurrentSettings()
        };
    }

    private generateSessionId(): string {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const random = Math.random().toString(36).substring(2, 8);
        return `session-${timestamp}-${random}`;
    }

    private captureCurrentSettings(): SessionSettings {
        const config = vscode.workspace.getConfiguration('ai-code-agent');
        return {
            model: config.get('model', 'claude-opus-4'),
            mode: config.get('mode', 'thinking'),
            maxTokens: config.get('maxTokensPerRequest', 100000),
            preprocessorModel: config.get('preprocessorModel', 'llama3')
        };
    }

    async addTask(task: AgentTask): Promise<void> {
        const taskRecord: TaskRecord = {
            task,
            startTime: new Date(),
            tokenUsage: { total: 0, byPurpose: {}, byModel: {} },
            filesModified: [],
            errors: []
        };

        this.currentSession.tasks.push(taskRecord);
        this.emitEvent({ type: 'task-added', data: taskRecord });
        await this.save();
    }

    async updateTask(taskId: string, updates: Partial<TaskRecord>): Promise<void> {
        const taskRecord = this.currentSession.tasks.find(t => t.task.id === taskId);
        if (taskRecord) {
            Object.assign(taskRecord, updates);
            
            // Extract file modifications from task steps
            if (updates.task?.steps) {
                const modifiedFiles = new Set<string>();
                for (const step of updates.task.steps) {
                    if (step.changes) {
                        step.changes.forEach(change => modifiedFiles.add(change.file));
                    }
                }
                taskRecord.filesModified = Array.from(modifiedFiles);
            }

            this.emitEvent({ type: 'task-updated', data: taskRecord });
            await this.save();
        }
    }

    async completeTask(taskId: string): Promise<void> {
        const taskRecord = this.currentSession.tasks.find(t => t.task.id === taskId);
        if (taskRecord) {
            taskRecord.endTime = new Date();
            
            // Calculate total token usage
            const relatedUsage = this.currentSession.usage.filter(u => 
                u.timestamp >= taskRecord.startTime &&
                (!taskRecord.endTime || u.timestamp <= taskRecord.endTime)
            );

            taskRecord.tokenUsage.total = relatedUsage.reduce(
                (sum, u) => sum + u.promptTokens + u.completionTokens, 0
            );

            // Group by purpose
            for (const usage of relatedUsage) {
                taskRecord.tokenUsage.byPurpose[usage.purpose] = 
                    (taskRecord.tokenUsage.byPurpose[usage.purpose] || 0) + 
                    usage.promptTokens + usage.completionTokens;
                
                const modelKey = `${usage.model}-${usage.mode}`;
                taskRecord.tokenUsage.byModel[modelKey] = 
                    (taskRecord.tokenUsage.byModel[modelKey] || 0) + 
                    usage.promptTokens + usage.completionTokens;
            }

            this.emitEvent({ type: 'task-completed', data: taskRecord });
            await this.save();
        }
    }

    addUsage(usage: Omit<UsageRecord, 'timestamp' | 'cost'>): void {
        const cost = this.calculateCost(usage);
        const record: UsageRecord = {
            ...usage,
            timestamp: new Date(),
            cost
        };

        this.currentSession.usage.push(record);
        this.emitEvent({ type: 'usage-added', data: record });
    }

    private calculateCost(usage: any): number {
        // Cost calculation based on model
        const rates: { [key: string]: { input: number; output: number } } = {
            'claude-opus-4': { input: 15, output: 75 },     // per 1M tokens
            'claude-sonnet-4': { input: 3, output: 15 }
        };

        const modelRates = rates[usage.model] || { input: 0, output: 0 };
        const inputCost = (usage.promptTokens / 1_000_000) * modelRates.input;
        const outputCost = (usage.completionTokens / 1_000_000) * modelRates.output;

        return inputCost + outputCost;
    }

    addReport(report: Omit<Report, 'timestamp'>): void {
        const fullReport: Report = {
            ...report,
            timestamp: new Date()
        };

        this.currentSession.reports.push(fullReport);
        this.emitEvent({ type: 'report-added', data: fullReport });
    }

    getSessionSummary(): any {
        const totalTasks = this.currentSession.tasks.length;
        const completedTasks = this.currentSession.tasks.filter(t => t.endTime).length;
        const failedTasks = this.currentSession.tasks.filter(t => 
            t.task.status === 'failed'
        ).length;

        const totalUsage = this.currentSession.usage.reduce((acc, u) => ({
            promptTokens: acc.promptTokens + u.promptTokens,
            completionTokens: acc.completionTokens + u.completionTokens,
            cost: acc.cost + u.cost
        }), { promptTokens: 0, completionTokens: 0, cost: 0 });

        const filesModified = new Set<string>();
        this.currentSession.tasks.forEach(t => 
            t.filesModified.forEach(f => filesModified.add(f))
        );

        const duration = this.currentSession.endTime 
            ? this.currentSession.endTime.getTime() - this.currentSession.startTime.getTime()
            : Date.now() - this.currentSession.startTime.getTime();

        return {
            sessionId: this.currentSession.id,
            startTime: this.currentSession.startTime,
            endTime: this.currentSession.endTime,
            duration: Math.floor(duration / 1000), // seconds
            tasks: {
                total: totalTasks,
                completed: completedTasks,
                failed: failedTasks,
                inProgress: totalTasks - completedTasks - failedTasks
            },
            usage: {
                totalTokens: totalUsage.promptTokens + totalUsage.completionTokens,
                promptTokens: totalUsage.promptTokens,
                completionTokens: totalUsage.completionTokens,
                cost: totalUsage.cost,
                byModel: this.groupUsageByModel()
            },
            filesModified: Array.from(filesModified),
            settings: this.currentSession.settings
        };
    }

    private groupUsageByModel(): any {
        const grouped: { [key: string]: any } = {};

        for (const usage of this.currentSession.usage) {
            const key = `${usage.model}-${usage.mode}`;
            if (!grouped[key]) {
                grouped[key] = {
                    promptTokens: 0,
                    completionTokens: 0,
                    cost: 0,
                    calls: 0
                };
            }

            grouped[key].promptTokens += usage.promptTokens;
            grouped[key].completionTokens += usage.completionTokens;
            grouped[key].cost += usage.cost;
            grouped[key].calls += 1;
        }

        return grouped;
    }

    async exportSession(format: 'json' | 'markdown' = 'json'): Promise<string> {
        const summary = this.getSessionSummary();
        
        if (format === 'json') {
            return JSON.stringify({
                ...this.currentSession,
                summary
            }, null, 2);
        } else {
            return this.generateMarkdownReport(summary);
        }
    }

    private generateMarkdownReport(summary: any): string {
        const report: string[] = [
            `# AI Code Agent Session Report`,
            ``,
            `**Session ID:** ${summary.sessionId}`,
            `**Start Time:** ${summary.startTime.toLocaleString()}`,
            summary.endTime ? `**End Time:** ${summary.endTime.toLocaleString()}` : '',
            `**Duration:** ${this.formatDuration(summary.duration)}`,
            ``,
            `## Summary`,
            ``,
            `### Tasks`,
            `- Total: ${summary.tasks.total}`,
            `- Completed: ${summary.tasks.completed}`,
            `- Failed: ${summary.tasks.failed}`,
            `- In Progress: ${summary.tasks.inProgress}`,
            ``,
            `### Token Usage`,
            `- Total Tokens: ${summary.usage.totalTokens.toLocaleString()}`,
            `- Prompt Tokens: ${summary.usage.promptTokens.toLocaleString()}`,
            `- Completion Tokens: ${summary.usage.completionTokens.toLocaleString()}`,
            `- Total Cost: $${summary.usage.cost.toFixed(4)}`,
            ``,
            `### Files Modified`,
            `Total: ${summary.filesModified.length} files`,
            ``
        ];

        if (summary.filesModified.length > 0) {
            report.push(...summary.filesModified.map((f: string) => `- ${f}`));
            report.push('');
        }

        report.push(
            `## Task Details`,
            ``
        );

        for (const taskRecord of this.currentSession.tasks) {
            const task = taskRecord.task;
            const duration = taskRecord.endTime 
                ? (taskRecord.endTime.getTime() - taskRecord.startTime.getTime()) / 1000
                : 0;

            report.push(
                `### ${task.description}`,
                `- Status: ${task.status}`,
                `- Duration: ${this.formatDuration(duration)}`,
                `- Tokens Used: ${taskRecord.tokenUsage.total.toLocaleString()}`,
                `- Files Modified: ${taskRecord.filesModified.length}`,
                ``
            );

            if (task.steps.length > 0) {
                report.push(`#### Steps:`);
                for (const step of task.steps) {
                    report.push(`- [${step.status}] ${step.description}`);
                }
                report.push('');
            }

            if (taskRecord.errors.length > 0) {
                report.push(`#### Errors:`);
                report.push(...taskRecord.errors.map(e => `- ${e}`));
                report.push('');
            }
        }

        return report.join('\n');
    }

    private formatDuration(seconds: number): string {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        const parts: string[] = [];
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

        return parts.join(' ');
    }

    async save(): Promise<void> {
        if (!this.sessionPath) {
            this.sessionPath = await this.getSessionPath();
        }

        try {
            const data = JSON.stringify(this.currentSession, null, 2);
            await fs.writeFile(this.sessionPath, data, 'utf8');
        } catch (error) {
            console.error('Failed to save session:', error);
        }
    }

    private async getSessionPath(): Promise<string> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder found');
        }

        const sessionsDir = path.join(
            workspaceFolder.uri.fsPath,
            '.ai-agent-sessions'
        );

        await fs.mkdir(sessionsDir, { recursive: true });
        
        return path.join(sessionsDir, `${this.currentSession.id}.json`);
    }

    async loadSession(sessionId: string): Promise<SessionData | null> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return null;
        }

        const sessionPath = path.join(
            workspaceFolder.uri.fsPath,
            '.ai-agent-sessions',
            `${sessionId}.json`
        );

        try {
            const data = await fs.readFile(sessionPath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('Failed to load session:', error);
            return null;
        }
    }

    async listSessions(): Promise<SessionInfo[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [];
        }

        const sessionsDir = path.join(
            workspaceFolder.uri.fsPath,
            '.ai-agent-sessions'
        );

        try {
            const files = await fs.readdir(sessionsDir);
            const sessions: SessionInfo[] = [];

            for (const file of files) {
                if (file.endsWith('.json')) {
                    const sessionPath = path.join(sessionsDir, file);
                    try {
                        const data = await fs.readFile(sessionPath, 'utf8');
                        const session = JSON.parse(data);
                        sessions.push({
                            id: session.id,
                            startTime: new Date(session.startTime),
                            endTime: session.endTime ? new Date(session.endTime) : undefined,
                            taskCount: session.tasks.length
                        });
                    } catch (error) {
                        console.error(`Failed to read session ${file}:`, error);
                    }
                }
            }

            return sessions.sort((a, b) => 
                b.startTime.getTime() - a.startTime.getTime()
            );
        } catch (error) {
            console.error('Failed to list sessions:', error);
            return [];
        }
    }

    private startAutoSave(): void {
        // Auto-save every 30 seconds
        this.autoSaveInterval = setInterval(() => {
            this.save().catch(console.error);
        }, 30000);
    }

    private emitEvent(event: SessionEvent): void {
        this.eventEmitter.fire(event);
    }

    endSession(): void {
        this.currentSession.endTime = new Date();
        this.save();
        
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
            this.autoSaveInterval = null;
        }

        this.emitEvent({ type: 'session-ended', data: this.currentSession });
    }

    startNewSession(): void {
        this.endSession();
        this.currentSession = this.createNewSession();
        this.sessionPath = '';
        this.startAutoSave();
        this.emitEvent({ type: 'session-started', data: this.currentSession });
    }

    dispose(): void {
        this.endSession();
        this.eventEmitter.dispose();
    }
}

export interface SessionInfo {
    id: string;
    startTime: Date;
    endTime?: Date;
    taskCount: number;
}

export interface SessionEvent {
    type: 'session-started' | 'session-ended' | 'task-added' | 'task-updated' | 
          'task-completed' | 'usage-added' | 'report-added';
    data: any;
}