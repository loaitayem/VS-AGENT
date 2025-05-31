import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { PreprocessorManager } from '../managers/preprocessor';

export interface CodeSymbol {
    name: string;
    type: 'class' | 'function' | 'interface' | 'variable' | 'method' | 'property';
    file: string;
    line: number;
    column: number;
    parent?: string;
    signature?: string;
    docstring?: string;
    references?: string[];
}

export interface FileIndex {
    path: string;
    language: string;
    size: number;
    lastModified: Date;
    symbols: CodeSymbol[];
    imports: string[];
    exports: string[];
    summary?: string;
    chunks?: CodeChunk[];
}

export interface CodeChunk {
    id: string;
    file: string;
    startLine: number;
    endLine: number;
    content: string;
    type: 'function' | 'class' | 'module' | 'block';
    symbols: string[];
    embedding?: number[];
}

export interface WorkspaceIndex {
    version: string;
    lastUpdated: Date;
    files: Map<string, FileIndex>;
    symbols: Map<string, CodeSymbol>;
    dependencies: Map<string, string[]>;
    searchIndex?: any;
}

export class CodebaseIndexer {
    private index: WorkspaceIndex;
    private indexPath: string;
    private fileQueue: Set<string> = new Set();
    private isIndexing: boolean = false;
    private excludePatterns: string[] = [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/out/**',
        '**/*.min.js',
        '**/*.map',
        '**/coverage/**',
        '**/.vscode/**',
        '**/package-lock.json',
        '**/yarn.lock'
    ];

    constructor(
        private _context: vscode.ExtensionContext,
        private preprocessor: PreprocessorManager
    ) {
        this.indexPath = path.join(this._context.globalStorageUri.fsPath, 'codebase-index.json');
        this.index = {
            version: '1.0',
            lastUpdated: new Date(),
            files: new Map(),
            symbols: new Map(),
            dependencies: new Map()
        };
        
        this.loadIndex();
    }

    async indexWorkspace(
        progress?: vscode.Progress<{ message?: string; increment?: number }>,
        token?: vscode.CancellationToken
    ): Promise<void> {
        if (this.isIndexing) {
            vscode.window.showWarningMessage('Indexing is already in progress');
            return;
        }

        this.isIndexing = true;

        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                throw new Error('No workspace folder open');
            }

            // Clear existing index
            this.index.files.clear();
            this.index.symbols.clear();
            this.index.dependencies.clear();

            // Count total files for progress
            let totalFiles = 0;
            const filesToIndex: vscode.Uri[] = [];

            for (const folder of workspaceFolders) {
                const files = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(folder, '**/*.{js,jsx,ts,tsx,py,java,cpp,c,cs,go,rs,rb,php,swift,kt,scala,r,m,h,hpp}'),
                    `{${this.excludePatterns.join(',')}}`
                );
                filesToIndex.push(...files);
                totalFiles += files.length;
            }

            progress?.report({ message: `Found ${totalFiles} files to index` });

            // Index files with progress
            let processedFiles = 0;
            const increment = 100 / totalFiles;

            for (const file of filesToIndex) {
                if (token?.isCancellationRequested) {
                    throw new Error('Indexing cancelled');
                }

                await this.indexFile(file);
                processedFiles++;
                
                progress?.report({
                    increment,
                    message: `Indexed ${processedFiles}/${totalFiles} files`
                });
            }

            // Build search index and embeddings
            progress?.report({ message: 'Building search index...' });
            await this.buildSearchIndex();

            // Save index
            await this.saveIndex();
            this.index.lastUpdated = new Date();

            vscode.window.showInformationMessage(`Indexed ${totalFiles} files successfully`);

        } catch (error) {
            vscode.window.showErrorMessage(`Indexing failed: ${error}`);
            throw error;
        } finally {
            this.isIndexing = false;
        }
    }

    async indexFile(uri: vscode.Uri): Promise<void> {
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            const content = await vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(content).toString('utf8');

            // Skip large files
            if (stat.size > 1024 * 1024) { // 1MB
                console.log(`Skipping large file: ${uri.fsPath}`);
                return;
            }

            // Detect language
            const language = this.detectLanguage(uri.fsPath);

            // Extract symbols using VS Code's symbol provider
            const document = await vscode.workspace.openTextDocument(uri);
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                document.uri
            );

            // Parse imports/exports
            const imports = this.extractImports(text, language);
            const exports = this.extractExports(text, language);

            // Create file index
            const fileIndex: FileIndex = {
                path: uri.fsPath,
                language,
                size: stat.size,
                lastModified: new Date(stat.mtime),
                symbols: [],
                imports,
                exports
            };

            // Process symbols
            if (symbols) {
                fileIndex.symbols = this.processSymbols(symbols, uri.fsPath);
            }

            // Create chunks for large files
            if (text.length > 2000) {
                fileIndex.chunks = await this.createChunks(uri.fsPath, text, fileIndex.symbols);
            }

            // Generate summary using preprocessor
            if (this.preprocessor.isAvailable()) {
                fileIndex.summary = await this.preprocessor.summarizeFile(text, language);
            }

            // Store in index
            this.index.files.set(uri.fsPath, fileIndex);

            // Update symbol index
            for (const symbol of fileIndex.symbols) {
                this.index.symbols.set(`${symbol.file}:${symbol.name}`, symbol);
            }

            // Update dependencies
            if (imports.length > 0) {
                this.index.dependencies.set(uri.fsPath, imports);
            }

        } catch (error) {
            console.error(`Failed to index file ${uri.fsPath}:`, error);
        }
    }

    private processSymbols(symbols: vscode.DocumentSymbol[], filePath: string, parent?: string): CodeSymbol[] {
        const result: CodeSymbol[] = [];

        for (const symbol of symbols) {
            const codeSymbol: CodeSymbol = {
                name: symbol.name,
                type: this.mapSymbolKind(symbol.kind),
                file: filePath,
                line: symbol.selectionRange.start.line,
                column: symbol.selectionRange.start.character,
                parent
            };

            result.push(codeSymbol);

            // Process children recursively
            if (symbol.children && symbol.children.length > 0) {
                result.push(...this.processSymbols(symbol.children, filePath, symbol.name));
            }
        }

        return result;
    }

    private async createChunks(filePath: string, content: string, symbols: CodeSymbol[]): Promise<CodeChunk[]> {
        const chunks: CodeChunk[] = [];
        const lines = content.split('\n');
        
        // Smart chunking based on symbols and structure
        let currentChunk: string[] = [];
        let chunkStart = 0;
        let chunkType: CodeChunk['type'] = 'block';
        let chunkSymbols: string[] = [];

        for (let i = 0; i < lines.length; i++) {
            currentChunk.push(lines[i]);

            // Check if we're at a symbol boundary
            const symbolAtLine = symbols.find(s => s.line === i);
            if (symbolAtLine) {
                if (symbolAtLine.type === 'class' || symbolAtLine.type === 'function') {
                    // Start new chunk at major symbols
                    if (currentChunk.length > 1) {
                        chunks.push({
                            id: `${filePath}:${chunkStart}-${i}`,
                            file: filePath,
                            startLine: chunkStart,
                            endLine: i - 1,
                            content: currentChunk.slice(0, -1).join('\n'),
                            type: chunkType,
                            symbols: chunkSymbols
                        });
                    }

                    currentChunk = [lines[i]];
                    chunkStart = i;
                    chunkType = symbolAtLine.type === 'class' ? 'class' : 'function';
                    chunkSymbols = [symbolAtLine.name];
                } else {
                    chunkSymbols.push(symbolAtLine.name);
                }
            }

            // Create chunk if it's getting too large
            if (currentChunk.length > 50) {
                chunks.push({
                    id: `${filePath}:${chunkStart}-${i}`,
                    file: filePath,
                    startLine: chunkStart,
                    endLine: i,
                    content: currentChunk.join('\n'),
                    type: chunkType,
                    symbols: chunkSymbols
                });

                currentChunk = [];
                chunkStart = i + 1;
                chunkType = 'block';
                chunkSymbols = [];
            }
        }

        // Add remaining chunk
        if (currentChunk.length > 0) {
            chunks.push({
                id: `${filePath}:${chunkStart}-${lines.length}`,
                file: filePath,
                startLine: chunkStart,
                endLine: lines.length - 1,
                content: currentChunk.join('\n'),
                type: chunkType,
                symbols: chunkSymbols
            });
        }

        // Generate embeddings for chunks if preprocessor supports it
        if (this.preprocessor.supportsEmbeddings()) {
            for (const chunk of chunks) {
                chunk.embedding = await this.preprocessor.generateEmbedding(chunk.content);
            }
        }

        return chunks;
    }

    private extractImports(content: string, language: string): string[] {
        const imports: string[] = [];
        
        switch (language) {
            case 'javascript':
            case 'typescript':
                // ES6 imports
                const es6Imports = content.match(/import\s+.*?\s+from\s+['"](.+?)['"]/g) || [];
                const requireImports = content.match(/require\s*\(\s*['"](.+?)['"]\s*\)/g) || [];
                imports.push(...es6Imports.map(i => i.match(/['"](.+?)['"]/)?.[1] || ''));
                imports.push(...requireImports.map(i => i.match(/['"](.+?)['"]/)?.[1] || ''));
                break;
            case 'python':
                const pyImports = content.match(/(?:from\s+(\S+)\s+)?import\s+.+/g) || [];
                imports.push(...pyImports.map(i => i.split(/\s+/)[1] || i.split(/\s+/)[3]));
                break;
            // Add more language-specific import extraction
        }

        return [...new Set(imports.filter(Boolean))];
    }

    private extractExports(content: string, language: string): string[] {
        const exports: string[] = [];
        
        switch (language) {
            case 'javascript':
            case 'typescript':
                const namedExports = content.match(/export\s+(?:const|let|var|function|class)\s+(\w+)/g) || [];
                exports.push(...namedExports.map(e => e.split(/\s+/).pop() || ''));
                
                const defaultExport = content.match(/export\s+default\s+(\w+)/);
                if (defaultExport) {
                    exports.push('default');
                }
                break;
            // Add more language-specific export extraction
        }

        return [...new Set(exports.filter(Boolean))];
    }

    private detectLanguage(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const languageMap: { [key: string]: string } = {
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.ts': 'typescript',
            '.tsx': 'typescript',
            '.py': 'python',
            '.java': 'java',
            '.cpp': 'cpp',
            '.c': 'c',
            '.cs': 'csharp',
            '.go': 'go',
            '.rs': 'rust',
            '.rb': 'ruby',
            '.php': 'php',
            '.swift': 'swift',
            '.kt': 'kotlin',
            '.scala': 'scala',
            '.r': 'r'
        };
        
        return languageMap[ext] || 'unknown';
    }

    private mapSymbolKind(kind: vscode.SymbolKind): CodeSymbol['type'] {
        switch (kind) {
            case vscode.SymbolKind.Class:
                return 'class';
            case vscode.SymbolKind.Function:
            case vscode.SymbolKind.Method:
                return 'function';
            case vscode.SymbolKind.Interface:
                return 'interface';
            case vscode.SymbolKind.Variable:
            case vscode.SymbolKind.Constant:
                return 'variable';
            case vscode.SymbolKind.Property:
            case vscode.SymbolKind.Field:
                return 'property';
            default:
                return 'variable';
        }
    }

    private async buildSearchIndex(): Promise<void> {
        // Build inverted index for text search
        const searchIndex = new Map<string, Set<string>>();

        for (const [filePath, fileIndex] of this.index.files) {
            // Index file path components
            const pathTokens = filePath.split(/[\/\\]/).flatMap(p => p.split(/[-_.]/).map(t => t.toLowerCase()));
            for (const token of pathTokens) {
                if (!searchIndex.has(token)) {
                    searchIndex.set(token, new Set());
                }
                searchIndex.get(token)!.add(filePath);
            }

            // Index symbols
            for (const symbol of fileIndex.symbols) {
                const tokens = symbol.name.split(/(?=[A-Z])|[-_]/).map(t => t.toLowerCase());
                for (const token of tokens) {
                    if (!searchIndex.has(token)) {
                        searchIndex.set(token, new Set());
                    }
                    searchIndex.get(token)!.add(filePath);
                }
            }
        }

        this.index.searchIndex = searchIndex;
    }

    async search(query: string): Promise<FileIndex[]> {
        const results: FileIndex[] = [];
        const queryTokens = query.toLowerCase().split(/\s+/);

        // Use preprocessor for semantic search if available
        if (this.preprocessor.supportsEmbeddings()) {
            const queryEmbedding = await this.preprocessor.generateEmbedding(query);
            
            // Find similar chunks
            const similarChunks = await this.findSimilarChunks(queryEmbedding, 10);
            const fileSet = new Set(similarChunks.map(c => c.file));
            
            for (const filePath of fileSet) {
                const fileIndex = this.index.files.get(filePath);
                if (fileIndex) {
                    results.push(fileIndex);
                }
            }
        }

        // Fallback to text search
        if (results.length === 0 && this.index.searchIndex) {
            const fileScores = new Map<string, number>();

            for (const token of queryTokens) {
                const files = this.index.searchIndex.get(token);
                if (files) {
                    for (const file of files) {
                        fileScores.set(file, (fileScores.get(file) || 0) + 1);
                    }
                }
            }

            // Sort by score
            const sortedFiles = Array.from(fileScores.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 20);

            for (const [filePath] of sortedFiles) {
                const fileIndex = this.index.files.get(filePath);
                if (fileIndex) {
                    results.push(fileIndex);
                }
            }
        }

        return results;
    }

    private async findSimilarChunks(embedding: number[], limit: number): Promise<CodeChunk[]> {
        const similarities: { chunk: CodeChunk; score: number }[] = [];

        for (const fileIndex of this.index.files.values()) {
            if (fileIndex.chunks) {
                for (const chunk of fileIndex.chunks) {
                    if (chunk.embedding) {
                        const score = this.cosineSimilarity(embedding, chunk.embedding);
                        similarities.push({ chunk, score });
                    }
                }
            }
        }

        // Sort by similarity and return top results
        return similarities
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(s => s.chunk);
    }

    private cosineSimilarity(a: number[], b: number[]): number {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    async addFile(uri: vscode.Uri): Promise<void> {
        this.fileQueue.add(uri.fsPath);
        this.processQueue();
    }

    async updateFile(uri: vscode.Uri): Promise<void> {
        this.fileQueue.add(uri.fsPath);
        this.processQueue();
    }

    async removeFile(uri: vscode.Uri): Promise<void> {
        this.index.files.delete(uri.fsPath);
        this.index.dependencies.delete(uri.fsPath);
        
        // Remove symbols
        const symbolsToRemove = Array.from(this.index.symbols.entries())
            .filter(([_key, symbol]) => symbol.file === uri.fsPath)
            .map(([key]) => key);
        
        for (const key of symbolsToRemove) {
            this.index.symbols.delete(key);
        }

        await this.saveIndex();
    }

    private async processQueue(): Promise<void> {
        if (this.fileQueue.size === 0 || this.isIndexing) {
            return;
        }

        const files = Array.from(this.fileQueue);
        this.fileQueue.clear();

        for (const filePath of files) {
            try {
                const uri = vscode.Uri.file(filePath);
                await this.indexFile(uri);
            } catch (error) {
                console.error(`Failed to process file ${filePath}:`, error);
            }
        }

        await this.saveIndex();
    }

    private async saveIndex(): Promise<void> {
        try {
            const indexData = {
                version: this.index.version,
                lastUpdated: this.index.lastUpdated,
                files: Array.from(this.index.files.entries()),
                symbols: Array.from(this.index.symbols.entries()),
                dependencies: Array.from(this.index.dependencies.entries())
            };

            await fs.mkdir(path.dirname(this.indexPath), { recursive: true });
            await fs.writeFile(this.indexPath, JSON.stringify(indexData, null, 2));
        } catch (error) {
            console.error('Failed to save index:', error);
        }
    }

    private async loadIndex(): Promise<void> {
        try {
            const data = await fs.readFile(this.indexPath, 'utf8');
            const indexData = JSON.parse(data);

            this.index = {
                version: indexData.version,
                lastUpdated: new Date(indexData.lastUpdated),
                files: new Map(indexData.files),
                symbols: new Map(indexData.symbols),
                dependencies: new Map(indexData.dependencies)
            };
        } catch (error) {
            console.log('No existing index found, starting fresh');
        }
    }

    getFileIndex(filePath: string): FileIndex | undefined {
        return this.index.files.get(filePath);
    }

    getSymbol(name: string, filePath?: string): CodeSymbol | undefined {
        if (filePath) {
            return this.index.symbols.get(`${filePath}:${name}`);
        }
        
        // Search all symbols
        for (const [_key, symbol] of this.index.symbols) {
            if (symbol.name === name) {
                return symbol;
            }
        }
        
        return undefined;
    }

    getWorkspaceStats(): any {
        return {
            totalFiles: this.index.files.size,
            totalSymbols: this.index.symbols.size,
            languages: this.getLanguageStats(),
            lastUpdated: this.index.lastUpdated
        };
    }

    private getLanguageStats(): { [key: string]: number } {
        const stats: { [key: string]: number } = {};
        
        for (const fileIndex of this.index.files.values()) {
            stats[fileIndex.language] = (stats[fileIndex.language] || 0) + 1;
        }
        
        return stats;
    }

    dispose(): void {
        this.saveIndex();
    }
}