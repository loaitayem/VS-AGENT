import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { FileChange } from '../core/core';

export interface EditOperation {
    file: string;
    type: 'create' | 'modify' | 'delete' | 'rename';
    content?: string;
    newPath?: string; // For rename operations
    backup?: string; // Backup content
    applied: boolean;
    error?: string;
}

export interface EditSession {
    id: string;
    startTime: Date;
    operations: EditOperation[];
    backupDir?: string;
    completed: boolean;
}

export class FileEditor {
    private currentSession: EditSession | null = null;
    private fileWatcher: vscode.FileSystemWatcher | null = null;
    private modifiedFiles: Set<string> = new Set();

    constructor() {
        // Watch for external file changes during edit sessions
        this.setupFileWatcher();
    }

    private setupFileWatcher() {
        this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
        
        this.fileWatcher.onDidChange(uri => {
            if (this.currentSession && this.modifiedFiles.has(uri.fsPath)) {
                vscode.window.showWarningMessage(
                    `File ${path.basename(uri.fsPath)} was modified externally during edit session`
                );
            }
        });
    }

    async startEditSession(): Promise<string> {
        if (this.currentSession && !this.currentSession.completed) {
            throw new Error('An edit session is already in progress');
        }

        const sessionId = this.generateSessionId();
        this.currentSession = {
            id: sessionId,
            startTime: new Date(),
            operations: [],
            completed: false
        };

        // Create backup directory
        const backupDir = await this.createBackupDirectory(sessionId);
        this.currentSession.backupDir = backupDir;

        return sessionId;
    }

    async applyChange(change: FileChange): Promise<void> {
        if (!this.currentSession) {
            await this.startEditSession();
        }

        const operation: EditOperation = {
            file: change.file,
            type: change.type,
            content: change.content,
            applied: false
        };

        try {
            // Create backup before modification
            if (change.type === 'modify' || change.type === 'delete') {
                await this.backupFile(change.file);
            }

            // Apply the change
            switch (change.type) {
                case 'create':
                    await this.createFile(change.file, change.content || '');
                    break;
                case 'modify':
                    await this.modifyFile(change.file, change.content || '');
                    break;
                case 'delete':
                    await this.deleteFile(change.file);
                    break;
            }

            operation.applied = true;
            this.modifiedFiles.add(change.file);

        } catch (error) {
            operation.error = error instanceof Error ? error.message : 'Unknown error';
            throw error;
        } finally {
            this.currentSession!.operations.push(operation);
        }
    }

    private async createFile(filePath: string, content: string): Promise<void> {
        const uri = vscode.Uri.file(filePath);
        
        // Check if file already exists
        try {
            await vscode.workspace.fs.stat(uri);
            const overwrite = await vscode.window.showWarningMessage(
                `File ${path.basename(filePath)} already exists. Overwrite?`,
                { modal: true },
                'Yes',
                'No'
            );
            
            if (overwrite !== 'Yes') {
                throw new Error('File creation cancelled by user');
            }
        } catch (error) {
            // File doesn't exist, which is what we want
        }

        // Ensure directory exists
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });

        // Write file
        const encoder = new TextEncoder();
        await vscode.workspace.fs.writeFile(uri, encoder.encode(content));

        // Open in editor
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });
    }

    private async modifyFile(filePath: string, newContent: string): Promise<void> {
        const uri = vscode.Uri.file(filePath);

        // Check if file is open in editor
        const openDoc = vscode.workspace.textDocuments.find(
            doc => doc.uri.fsPath === uri.fsPath
        );

        if (openDoc) {
            // File is open - use text editor edit
            const editor = await vscode.window.showTextDocument(openDoc);
            await editor.edit(editBuilder => {
                const fullRange = new vscode.Range(
                    openDoc.positionAt(0),
                    openDoc.positionAt(openDoc.getText().length)
                );
                editBuilder.replace(fullRange, newContent);
            });
        } else {
            // File is not open - write directly
            const encoder = new TextEncoder();
            await vscode.workspace.fs.writeFile(uri, encoder.encode(newContent));
        }
    }

    private async deleteFile(filePath: string): Promise<void> {
        const uri = vscode.Uri.file(filePath);
        
        const confirm = await vscode.window.showWarningMessage(
            `Delete ${path.basename(filePath)}?`,
            { modal: true },
            'Delete',
            'Cancel'
        );
        
        if (confirm !== 'Delete') {
            throw new Error('File deletion cancelled by user');
        }

        await vscode.workspace.fs.delete(uri);
    }

    private async backupFile(filePath: string): Promise<void> {
        if (!this.currentSession?.backupDir) {
            throw new Error('No backup directory available');
        }

        try {
            const uri = vscode.Uri.file(filePath);
            const content = await vscode.workspace.fs.readFile(uri);
            
            // Create backup path preserving directory structure
            const relativePath = vscode.workspace.asRelativePath(filePath);
            const backupPath = path.join(this.currentSession.backupDir, relativePath);
            
            // Ensure backup directory exists
            await fs.mkdir(path.dirname(backupPath), { recursive: true });
            
            // Write backup
            await fs.writeFile(backupPath, content);
            
            // Store backup reference
            const operation = this.currentSession.operations.find(
                op => op.file === filePath && !op.backup
            );
            if (operation) {
                operation.backup = backupPath;
            }
        } catch (error) {
            console.error(`Failed to backup file ${filePath}:`, error);
            // Don't fail the operation if backup fails, but log it
        }
    }

    async completeSession(): Promise<EditSession> {
        if (!this.currentSession) {
            throw new Error('No active edit session');
        }

        this.currentSession.completed = true;
        const session = this.currentSession;
        
        // Show summary
        const successful = session.operations.filter(op => op.applied).length;
        const failed = session.operations.filter(op => !op.applied).length;
        
        vscode.window.showInformationMessage(
            `Edit session completed: ${successful} successful, ${failed} failed operations`
        );

        // Clear state
        this.currentSession = null;
        this.modifiedFiles.clear();

        return session;
    }

    async rollbackSession(sessionId?: string): Promise<void> {
        const session = sessionId 
            ? await this.loadSession(sessionId)
            : this.currentSession;

        if (!session) {
            throw new Error('No session to rollback');
        }

        const operations = session.operations.filter(op => op.applied).reverse();
        let rolledBack = 0;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Rolling back changes...',
            cancellable: false
        }, async (progress) => {
            for (const operation of operations) {
                progress.report({
                    increment: 100 / operations.length,
                    message: `Reverting ${path.basename(operation.file)}`
                });

                try {
                    await this.rollbackOperation(operation);
                    rolledBack++;
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to rollback ${operation.file}: ${error}`
                    );
                }
            }
        });

        vscode.window.showInformationMessage(
            `Rolled back ${rolledBack} of ${operations.length} operations`
        );
    }

    private async rollbackOperation(operation: EditOperation): Promise<void> {
        switch (operation.type) {
            case 'create':
                // Delete the created file
                await vscode.workspace.fs.delete(vscode.Uri.file(operation.file));
                break;
                
            case 'modify':
            case 'delete':
                // Restore from backup
                if (operation.backup) {
                    const backupContent = await fs.readFile(operation.backup);
                    
                    if (operation.type === 'delete') {
                        // Recreate deleted file
                        await vscode.workspace.fs.writeFile(
                            vscode.Uri.file(operation.file),
                            backupContent
                        );
                    } else {
                        // Restore modified file
                        await this.modifyFile(operation.file, backupContent.toString());
                    }
                }
                break;
        }
    }

    async applyBulkChanges(
        changes: FileChange[],
        options?: { 
            confirmEach?: boolean;
            dryRun?: boolean;
            parallel?: boolean;
        }
    ): Promise<{ applied: number; failed: number; errors: string[] }> {
        const sessionId = await this.startEditSession();
        const results = {
            applied: 0,
            failed: 0,
            errors: [] as string[]
        };

        try {
            // Group changes by file to detect conflicts
            const changesByFile = this.groupChangesByFile(changes);
            
            // Check for conflicts
            const conflicts = this.detectConflicts(changesByFile);
            if (conflicts.length > 0) {
                const proceed = await vscode.window.showWarningMessage(
                    `Detected ${conflicts.length} file conflicts. Proceed anyway?`,
                    { modal: true },
                    'Proceed',
                    'Cancel'
                );
                
                if (proceed !== 'Proceed') {
                    throw new Error('Bulk changes cancelled due to conflicts');
                }
            }

            // Apply changes
            const changePromises = options?.parallel 
                ? changes.map(change => this.applySingleChange(change, options))
                : changes.reduce(async (prev, change) => {
                    await prev;
                    return this.applySingleChange(change, options);
                  }, Promise.resolve());

            if (options?.parallel) {
                const results = await Promise.allSettled(changePromises as Promise<void>[]);
                let applied = 0;
                let failed = 0;
                const errors: string[] = [];
                
                results.forEach((result, index) => {
                    if (result.status === 'fulfilled') {
                        applied++;
                    } else {
                        failed++;
                        errors.push(
                            `${changes[index].file}: ${result.reason}`
                        );
                    }
                });
            } else {
                await changePromises;
            }

        } catch (error) {
            results.errors.push(error instanceof Error ? error.message : 'Unknown error');
            
            // Offer to rollback on failure
            const rollback = await vscode.window.showErrorMessage(
                'Bulk changes failed. Rollback applied changes?',
                'Rollback',
                'Keep Changes'
            );
            
            if (rollback === 'Rollback') {
                await this.rollbackSession(sessionId);
            }
        } finally {
            await this.completeSession();
        }

        return results;
    }

    private async applySingleChange(
        change: FileChange,
        options?: { confirmEach?: boolean; dryRun?: boolean }
    ): Promise<void> {
        if (options?.confirmEach) {
            const action = change.type === 'create' ? 'Create' 
                        : change.type === 'modify' ? 'Modify'
                        : 'Delete';
                        
            const confirm = await vscode.window.showInformationMessage(
                `${action} ${path.basename(change.file)}?`,
                { modal: true },
                'Yes',
                'Skip'
            );
            
            if (confirm !== 'Yes') {
                return;
            }
        }

        if (!options?.dryRun) {
            await this.applyChange(change);
        }
    }

    private groupChangesByFile(changes: FileChange[]): Map<string, FileChange[]> {
        const grouped = new Map<string, FileChange[]>();
        
        for (const change of changes) {
            if (!grouped.has(change.file)) {
                grouped.set(change.file, []);
            }
            grouped.get(change.file)!.push(change);
        }

        return grouped;
    }

    private detectConflicts(changesByFile: Map<string, FileChange[]>): string[] {
        const conflicts: string[] = [];

        for (const [file, changes] of changesByFile) {
            if (changes.length > 1) {
                // Multiple changes to same file
                const types = new Set(changes.map(c => c.type));
                if (types.size > 1) {
                    conflicts.push(`${file}: conflicting operations (${Array.from(types).join(', ')})`);
                }
            }
        }

        return conflicts;
    }

    private async createBackupDirectory(sessionId: string): Promise<string> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder found');
        }

        const backupRoot = path.join(
            workspaceFolder.uri.fsPath,
            '.ai-agent-backups',
            sessionId
        );

        await fs.mkdir(backupRoot, { recursive: true });
        return backupRoot;
    }

    private generateSessionId(): string {
        return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    private async loadSession(_sessionId: string): Promise<EditSession | null> {
        // Implementation for loading previous sessions from backup directory
        // This would read session metadata from the backup directory
        return null;
    }

    async showFileDiff(filePath: string, newContent: string): Promise<void> {
        const uri = vscode.Uri.file(filePath);
        
        // Create a temporary file with new content
        const tempUri = vscode.Uri.parse(`ai-agent-diff:${filePath}?new`);
        
        // Register a content provider for the diff
        const provider = new (class implements vscode.TextDocumentContentProvider {
            provideTextDocumentContent(): string {
                return newContent;
            }
        })();

        const disposable = vscode.workspace.registerTextDocumentContentProvider(
            'ai-agent-diff',
            provider
        );

        try {
            await vscode.commands.executeCommand(
                'vscode.diff',
                uri,
                tempUri,
                `${path.basename(filePath)} ← AI Agent Changes`
            );
        } finally {
            disposable.dispose();
        }
    }

    dispose(): void {
        this.fileWatcher?.dispose();
    }
}