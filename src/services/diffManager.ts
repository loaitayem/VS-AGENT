import * as vscode from 'vscode';
import * as path from 'path';

// Import diff with manual typing
const diff: any = require('diff');

export interface DiffResult {
    file: string;
    diff: string;
    additions: number;
    deletions: number;
    chunks: DiffChunk[];
    summary: string;
}

export interface DiffChunk {
    startLine: number;
    endLine: number;
    type: 'added' | 'removed' | 'modified';
    content: string;
    lineChanges: LineChange[];
}

export interface LineChange {
    line: number;
    type: 'added' | 'removed' | 'unchanged';
    content: string;
}

export interface DiffOptions {
    context: number; // Lines of context around changes
    ignoreWhitespace: boolean;
    ignoreCase: boolean;
    unified: boolean;
}

export class DiffManager {
    private defaultOptions: DiffOptions = {
        context: 3,
        ignoreWhitespace: false,
        ignoreCase: false,
        unified: true
    };

    async createDiff(
        filePath: string,
        newContent: string,
        options?: Partial<DiffOptions>
    ): Promise<string> {
        const opts = { ...this.defaultOptions, ...options };
        
        try {
            // Read current file content
            const uri = vscode.Uri.file(filePath);
            const currentContent = await this.readFile(uri);

            // Create diff
            if (opts.unified) {
                return this.createUnifiedDiff(filePath, currentContent, newContent, opts);
            } else {
                return this.createStructuredDiff(currentContent, newContent, opts);
            }
        } catch (error) {
            // File doesn't exist yet - show as new file
            return this.createNewFileDiff(filePath, newContent);
        }
    }

    private async readFile(uri: vscode.Uri): Promise<string> {
        const content = await vscode.workspace.fs.readFile(uri);
        return Buffer.from(content).toString('utf8');
    }

    private createUnifiedDiff(
        filePath: string,
        oldContent: string,
        newContent: string,
        options: DiffOptions
    ): string {
        const filename = path.basename(filePath);
        
        return diff.createPatch(
            filename,
            oldContent,
            newContent,
            'original',
            'modified',
            {
                context: options.context,
                ignoreWhitespace: options.ignoreWhitespace,
                ignoreCase: options.ignoreCase
            }
        );
    }

    private createStructuredDiff(
        oldContent: string,
        newContent: string,
        options: DiffOptions
    ): string {
        const changes = diff.diffLines(oldContent, newContent, {
            ignoreWhitespace: options.ignoreWhitespace,
            ignoreCase: options.ignoreCase
        });

        let result = '';

        for (const change of changes) {
            if (change.added) {
                result += `+++ ${change.value}`;
            } else if (change.removed) {
                result += `--- ${change.value}`;
            } else {
                // Context lines
                const lines = change.value.split('\n').slice(0, options.context);
                result += lines.map((l: string) => `    ${l}`).join('\n') + '\n';
            }
        }

        return result;
    }

    private createNewFileDiff(filePath: string, content: string): string {
        const filename = path.basename(filePath);
        const lines = content.split('\n');
        
        return `--- /dev/null
+++ ${filename}
@@ -0,0 +1,${lines.length} @@
${lines.map(line => `+${line}`).join('\n')}`;
    }

    async analyzeDiff(
        filePath: string,
        newContent: string
    ): Promise<DiffResult> {
        try {
            const uri = vscode.Uri.file(filePath);
            const oldContent = await this.readFile(uri);
            
            const changes = diff.diffLines(oldContent, newContent);
            const chunks = this.extractChunks(changes);
            
            let additions = 0;
            let deletions = 0;

            for (const change of changes) {
                if (change.added) {
                    additions += change.count || 1;
                } else if (change.removed) {
                    deletions += change.count || 1;
                }
            }

            const unifiedDiff = this.createUnifiedDiff(
                filePath,
                oldContent,
                newContent,
                this.defaultOptions
            );

            return {
                file: filePath,
                diff: unifiedDiff,
                additions,
                deletions,
                chunks,
                summary: this.generateSummary(chunks, additions, deletions)
            };
        } catch (error) {
            // New file
            const lines = newContent.split('\n').length;
            return {
                file: filePath,
                diff: this.createNewFileDiff(filePath, newContent),
                additions: lines,
                deletions: 0,
                chunks: [{
                    startLine: 1,
                    endLine: lines,
                    type: 'added',
                    content: newContent,
                    lineChanges: newContent.split('\n').map((content, i) => ({
                        line: i + 1,
                        type: 'added',
                        content
                    }))
                }],
                summary: `New file with ${lines} lines`
            };
        }
    }

    private extractChunks(changes: any[]): DiffChunk[] {
        const chunks: DiffChunk[] = [];
        let currentLine = 1;
        let currentChunk: DiffChunk | null = null;

        for (const change of changes) {
            const lines = change.value.split('\n').filter((l: string) => l !== '');
            
            if (change.added || change.removed) {
                const type = change.added ? 'added' : 'removed';
                
                if (!currentChunk || currentChunk.type !== 'modified') {
                    currentChunk = {
                        startLine: currentLine,
                        endLine: currentLine + lines.length - 1,
                        type: 'modified',
                        content: '',
                        lineChanges: []
                    };
                    chunks.push(currentChunk);
                }

                for (const line of lines) {
                    currentChunk.lineChanges.push({
                        line: currentLine++,
                        type: type as 'added' | 'removed',
                        content: line
                    });
                }
                
                currentChunk.endLine = currentLine - 1;
            } else {
                // Unchanged lines
                currentLine += lines.length;
                currentChunk = null;
            }
        }

        return chunks;
    }

    private generateSummary(
        chunks: DiffChunk[],
        additions: number,
        deletions: number
    ): string {
        if (additions === 0 && deletions === 0) {
            return 'No changes';
        }

        const parts: string[] = [];
        
        if (additions > 0) {
            parts.push(`+${additions} line${additions !== 1 ? 's' : ''}`);
        }
        
        if (deletions > 0) {
            parts.push(`-${deletions} line${deletions !== 1 ? 's' : ''}`);
        }

        parts.push(`in ${chunks.length} chunk${chunks.length !== 1 ? 's' : ''}`);

        return parts.join(', ');
    }

    async showDiffPreview(
        changes: DiffResult[],
        title: string = 'AI Agent Changes'
    ): Promise<boolean> {
        const panel = vscode.window.createWebviewPanel(
            'ai-agent-diff-preview',
            title,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        panel.webview.html = this.getDiffPreviewHtml(changes);

        return new Promise((resolve) => {
            panel.webview.onDidReceiveMessage(
                message => {
                    switch (message.command) {
                        case 'approve':
                            panel.dispose();
                            resolve(true);
                            break;
                        case 'reject':
                            panel.dispose();
                            resolve(false);
                            break;
                        case 'openFile':
                            this.openFileInDiff(message.file, message.content);
                            break;
                    }
                },
                undefined,
                []
            );

            panel.onDidDispose(() => {
                resolve(false);
            });
        });
    }

    private getDiffPreviewHtml(changes: DiffResult[]): string {
        const totalAdditions = changes.reduce((sum, c) => sum + c.additions, 0);
        const totalDeletions = changes.reduce((sum, c) => sum + c.deletions, 0);

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Diff Preview</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 20px;
                }
                .summary {
                    margin-bottom: 20px;
                    padding: 10px;
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                    border-radius: 4px;
                }
                .file-diff {
                    margin-bottom: 20px;
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    overflow: hidden;
                }
                .file-header {
                    padding: 10px;
                    background-color: var(--vscode-editor-selectionBackground);
                    cursor: pointer;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .file-stats {
                    font-size: 0.9em;
                    opacity: 0.8;
                }
                .diff-content {
                    max-height: 400px;
                    overflow-y: auto;
                    font-family: var(--vscode-editor-font-family);
                    font-size: var(--vscode-editor-font-size);
                    white-space: pre;
                    padding: 10px;
                }
                .line-added {
                    background-color: rgba(0, 255, 0, 0.1);
                    color: var(--vscode-gitDecoration-addedResourceForeground);
                }
                .line-removed {
                    background-color: rgba(255, 0, 0, 0.1);
                    color: var(--vscode-gitDecoration-deletedResourceForeground);
                }
                .actions {
                    position: sticky;
                    bottom: 0;
                    background-color: var(--vscode-editor-background);
                    padding: 20px;
                    border-top: 1px solid var(--vscode-panel-border);
                    display: flex;
                    gap: 10px;
                    justify-content: center;
                }
                button {
                    padding: 8px 16px;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                }
                .approve {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                }
                .reject {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                }
                button:hover {
                    opacity: 0.9;
                }
            </style>
        </head>
        <body>
            <div class="summary">
                <h2>Change Summary</h2>
                <p>${changes.length} files changed, 
                   <span style="color: var(--vscode-gitDecoration-addedResourceForeground)">+${totalAdditions} additions</span>, 
                   <span style="color: var(--vscode-gitDecoration-deletedResourceForeground)">-${totalDeletions} deletions</span>
                </p>
            </div>

            ${changes.map(change => this.renderFileDiff(change)).join('')}

            <div class="actions">
                <button class="approve" onclick="approve()">Apply Changes</button>
                <button class="reject" onclick="reject()">Cancel</button>
            </div>

            <script>
                const vscode = acquireVsCodeApi();

                function approve() {
                    vscode.postMessage({ command: 'approve' });
                }

                function reject() {
                    vscode.postMessage({ command: 'reject' });
                }

                function openFile(file, content) {
                    vscode.postMessage({ 
                        command: 'openFile',
                        file: file,
                        content: content
                    });
                }

                function toggleDiff(index) {
                    const content = document.getElementById('diff-' + index);
                    content.style.display = content.style.display === 'none' ? 'block' : 'none';
                }
            </script>
        </body>
        </html>`;
    }

    private renderFileDiff(change: DiffResult): string {
        const index = Math.random().toString(36).substr(2, 9);
        const filename = path.basename(change.file);
        
        return `
        <div class="file-diff">
            <div class="file-header" onclick="toggleDiff('${index}')">
                <span>${filename}</span>
                <span class="file-stats">
                    <span style="color: var(--vscode-gitDecoration-addedResourceForeground)">+${change.additions}</span>
                    <span style="color: var(--vscode-gitDecoration-deletedResourceForeground)">-${change.deletions}</span>
                </span>
            </div>
            <div id="diff-${index}" class="diff-content">
                ${this.renderDiffContent(change.diff)}
            </div>
        </div>`;
    }

    private renderDiffContent(diff: string): string {
        return diff.split('\n').map(line => {
            if (line.startsWith('+') && !line.startsWith('+++')) {
                return `<div class="line-added">${this.escapeHtml(line)}</div>`;
            } else if (line.startsWith('-') && !line.startsWith('---')) {
                return `<div class="line-removed">${this.escapeHtml(line)}</div>`;
            } else {
                return `<div>${this.escapeHtml(line)}</div>`;
            }
        }).join('');
    }

    private escapeHtml(text: string): string {
        const map: { [key: string]: string } = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    private async openFileInDiff(filePath: string, newContent: string): Promise<void> {
        const uri = vscode.Uri.file(filePath);
        
        // Create temporary document with new content
        const tempUri = vscode.Uri.parse(`ai-agent-temp:${filePath}`);
        
        const provider = new (class implements vscode.TextDocumentContentProvider {
            provideTextDocumentContent(): string {
                return newContent;
            }
        })();

        const disposable = vscode.workspace.registerTextDocumentContentProvider(
            'ai-agent-temp',
            provider
        );

        try {
            await vscode.commands.executeCommand(
                'vscode.diff',
                uri,
                tempUri,
                `${path.basename(filePath)} ← AI Changes`
            );
        } finally {
            setTimeout(() => disposable.dispose(), 60000); // Clean up after 1 minute
        }
    }

    async exportDiff(
        changes: DiffResult[],
        outputPath: string
    ): Promise<void> {
        const output: string[] = [
            '# AI Agent Changes',
            `Generated: ${new Date().toISOString()}`,
            '',
            '## Summary',
            `Files changed: ${changes.length}`,
            `Total additions: ${changes.reduce((sum, c) => sum + c.additions, 0)}`,
            `Total deletions: ${changes.reduce((sum, c) => sum + c.deletions, 0)}`,
            '',
            '## Changes',
            ''
        ];

        for (const change of changes) {
            output.push(`### ${change.file}`);
            output.push(change.summary);
            output.push('```diff');
            output.push(change.diff);
            output.push('```');
            output.push('');
        }

        const uri = vscode.Uri.file(outputPath);
        const encoder = new TextEncoder();
        await vscode.workspace.fs.writeFile(uri, encoder.encode(output.join('\n')));
        
        // Open the exported diff
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);
    }
}