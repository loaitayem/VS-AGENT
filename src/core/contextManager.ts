import * as vscode from 'vscode';
import { CodebaseIndexer, CodeChunk, FileIndex } from '../services/indexer';
import { PreprocessorManager, RankingResult } from '../managers/preprocessor';

export interface ContextWindow {
    files: ContextFile[];
    chunks: CodeChunk[];
    summary: string;
    totalTokens: number;
    relevanceMap: Map<string, number>;
}

export interface ContextFile {
    path: string;
    content: string;
    language: string;
    tokens: number;
    relevance: number;
    summary?: string;
    includedChunks?: string[];
}

export interface ContextOptions {
    maxTokens: number;
    includeImports: boolean;
    includeExports: boolean;
    includeDocstrings: boolean;
    smartChunking: boolean;
    relevanceThreshold: number;
}

export class ContextManager {
    private defaultOptions: ContextOptions = {
        maxTokens: 100000,
        includeImports: true,
        includeExports: true,
        includeDocstrings: true,
        smartChunking: true,
        relevanceThreshold: 0.5
    };

    constructor(
        private indexer: CodebaseIndexer,
        private preprocessor: PreprocessorManager
    ) {}

    async prepareContext(
        relevantFiles: RankingResult[] | string[],
        maxTokens: number,
        query?: string,
        options?: Partial<ContextOptions>
    ): Promise<ContextWindow> {
        const opts = { ...this.defaultOptions, ...options, maxTokens };
        const contextWindow: ContextWindow = {
            files: [],
            chunks: [],
            summary: '',
            totalTokens: 0,
            relevanceMap: new Map()
        };

        // Rank files by relevance if query provided
        let rankedFiles: string[];
        if (query && this.preprocessor.isAvailable()) {
            // Convert relevantFiles to string array if it's RankingResult[]
            const fileList = Array.isArray(relevantFiles) && relevantFiles.length > 0 && typeof relevantFiles[0] === 'object' && 'file' in relevantFiles[0]
                ? (relevantFiles as RankingResult[]).map(r => r.file)
                : relevantFiles as string[];
                
            const rankings = await this.preprocessor.rankRelevantFiles(fileList, query);
            rankedFiles = rankings
                .filter(r => r.score >= opts.relevanceThreshold)
                .sort((a, b) => b.score - a.score)
                .map(r => {
                    contextWindow.relevanceMap.set(r.file, r.score);
                    return r.file;
                });
        } else {
            // Convert to string array if needed
            rankedFiles = Array.isArray(relevantFiles) && relevantFiles.length > 0 && typeof relevantFiles[0] === 'object' && 'file' in relevantFiles[0]
                ? (relevantFiles as RankingResult[]).map(r => r.file)
                : relevantFiles as string[];
        }

        // Process files in order of relevance
        for (const filePath of rankedFiles) {
            if (contextWindow.totalTokens >= opts.maxTokens) {
                break;
            }

            const fileContext = await this.processFile(
                filePath,
                opts.maxTokens - contextWindow.totalTokens,
                query,
                opts
            );

            if (fileContext) {
                contextWindow.files.push(fileContext);
                contextWindow.totalTokens += fileContext.tokens;
            }
        }

        // Generate context summary
        if (this.preprocessor.isAvailable()) {
            contextWindow.summary = await this.generateContextSummary(contextWindow, query);
        }

        return contextWindow;
    }

    private async processFile(
        filePath: string,
        remainingTokens: number,
        query?: string,
        options?: ContextOptions
    ): Promise<ContextFile | null> {
        try {
            const uri = vscode.Uri.file(filePath);
            const content = await vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(content).toString('utf8');
            
            const fileIndex = this.indexer.getFileIndex(filePath);
            if (!fileIndex) {
                return null;
            }

            const tokenCount = this.estimateTokens(text);
            
            // If file is small enough, include it whole
            if (tokenCount <= remainingTokens && tokenCount < 2000) {
                return {
                    path: filePath,
                    content: text,
                    language: fileIndex.language,
                    tokens: tokenCount,
                    relevance: this.getRelevance(filePath),
                    summary: fileIndex.summary
                };
            }

            // Otherwise, use smart chunking
            if (options?.smartChunking && fileIndex.chunks) {
                const selectedChunks = await this.selectRelevantChunks(
                    fileIndex.chunks,
                    remainingTokens,
                    query
                );

                if (selectedChunks.length > 0) {
                    const chunkedContent = this.assembleChunks(selectedChunks, text);
                    const chunkedTokens = this.estimateTokens(chunkedContent);

                    return {
                        path: filePath,
                        content: chunkedContent,
                        language: fileIndex.language,
                        tokens: chunkedTokens,
                        relevance: this.getRelevance(filePath),
                        summary: fileIndex.summary,
                        includedChunks: selectedChunks.map(c => c.id)
                    };
                }
            }

            // Fallback: include file header and key symbols
            const condensed = this.condenseFile(text, fileIndex, remainingTokens, options);
            return {
                path: filePath,
                content: condensed,
                language: fileIndex.language,
                tokens: this.estimateTokens(condensed),
                relevance: this.getRelevance(filePath),
                summary: fileIndex.summary
            };

        } catch (error) {
            console.error(`Failed to process file ${filePath}:`, error);
            return null;
        }
    }

    private async selectRelevantChunks(
        chunks: CodeChunk[],
        maxTokens: number,
        query?: string
    ): Promise<CodeChunk[]> {
        if (!query || chunks.length === 0) {
            // Without query, select chunks with most symbols
            return chunks
                .sort((a, b) => b.symbols.length - a.symbols.length)
                .slice(0, Math.ceil(maxTokens / 500)); // Rough estimate
        }

        // Use embeddings if available
        if (this.preprocessor.supportsEmbeddings() && chunks[0].embedding) {
            const queryEmbedding = await this.preprocessor.generateEmbedding(query);
            
            const scored = chunks.map(chunk => ({
                chunk,
                score: this.cosineSimilarity(queryEmbedding, chunk.embedding!)
            }));

            scored.sort((a, b) => b.score - a.score);

            const selected: CodeChunk[] = [];
            let currentTokens = 0;

            for (const { chunk } of scored) {
                const chunkTokens = this.estimateTokens(chunk.content);
                if (currentTokens + chunkTokens <= maxTokens) {
                    selected.push(chunk);
                    currentTokens += chunkTokens;
                } else {
                    break;
                }
            }

            return selected;
        }

        // Fallback: text-based relevance
        const queryTerms = query.toLowerCase().split(/\s+/);
        const scored = chunks.map(chunk => {
            let score = 0;
            const chunkLower = chunk.content.toLowerCase();
            
            for (const term of queryTerms) {
                if (chunkLower.includes(term)) {
                    score += 1;
                }
            }

            // Boost chunks with relevant symbols
            for (const symbol of chunk.symbols) {
                if (queryTerms.some(term => symbol.toLowerCase().includes(term))) {
                    score += 2;
                }
            }

            return { chunk, score };
        });

        scored.sort((a, b) => b.score - a.score);

        const selected: CodeChunk[] = [];
        let currentTokens = 0;

        for (const { chunk, score } of scored) {
            if (score === 0) break; // Skip irrelevant chunks
            
            const chunkTokens = this.estimateTokens(chunk.content);
            if (currentTokens + chunkTokens <= maxTokens) {
                selected.push(chunk);
                currentTokens += chunkTokens;
            } else {
                break;
            }
        }

        return selected;
    }

    private assembleChunks(chunks: CodeChunk[], fullContent: string): string {
        // Sort chunks by line number to maintain order
        chunks.sort((a, b) => a.startLine - b.startLine);

        const lines = fullContent.split('\n');
        const sections: string[] = [];
        let lastEndLine = -1;

        for (const chunk of chunks) {
            // Add ellipsis if there's a gap
            if (lastEndLine !== -1 && chunk.startLine > lastEndLine + 1) {
                sections.push('\n// ... (code omitted) ...\n');
            }

            // Add chunk content
            const chunkLines = lines.slice(chunk.startLine, chunk.endLine + 1);
            sections.push(chunkLines.join('\n'));
            
            lastEndLine = chunk.endLine;
        }

        return sections.join('\n');
    }

    private condenseFile(
        content: string,
        fileIndex: FileIndex,
        maxTokens: number,
        options?: ContextOptions
    ): string {
        const lines = content.split('\n');
        const condensed: string[] = [];
        let currentTokens = 0;

        // Add file header (imports/exports)
        if (options?.includeImports && fileIndex.imports.length > 0) {
            const importSection = this.extractImportSection(lines, fileIndex.language);
            condensed.push(...importSection);
            condensed.push('');
            currentTokens += this.estimateTokens(importSection.join('\n'));
        }

        // Add main symbols
        const symbols = fileIndex.symbols
            .filter(s => s.type === 'class' || s.type === 'function' || s.type === 'interface')
            .sort((a, b) => a.line - b.line);

        for (const symbol of symbols) {
            if (currentTokens >= maxTokens) break;

            const symbolContent = this.extractSymbolContent(lines, symbol.line, fileIndex.language);
            const symbolTokens = this.estimateTokens(symbolContent);

            if (currentTokens + symbolTokens <= maxTokens) {
                condensed.push(symbolContent);
                condensed.push('');
                currentTokens += symbolTokens;
            }
        }

        // Add exports if room
        if (options?.includeExports && fileIndex.exports.length > 0 && currentTokens < maxTokens) {
            const exportSection = this.extractExportSection(lines, fileIndex.language);
            condensed.push(...exportSection);
        }

        return condensed.join('\n');
    }

    private extractImportSection(lines: string[], language: string): string[] {
        const imports: string[] = [];
        let inImportBlock = false;

        for (const line of lines) {
            const trimmed = line.trim();
            
            if (language === 'javascript' || language === 'typescript') {
                if (trimmed.startsWith('import ') || trimmed.startsWith('const ') && line.includes('require(')) {
                    imports.push(line);
                    inImportBlock = true;
                } else if (inImportBlock && trimmed === '') {
                    continue;
                } else if (inImportBlock) {
                    break;
                }
            } else if (language === 'python') {
                if (trimmed.startsWith('import ') || trimmed.startsWith('from ')) {
                    imports.push(line);
                    inImportBlock = true;
                } else if (inImportBlock && !trimmed.startsWith('import') && !trimmed.startsWith('from')) {
                    break;
                }
            }
            // Add more language-specific logic as needed
        }

        return imports;
    }

    private extractExportSection(lines: string[], language: string): string[] {
        const exports: string[] = [];

        if (language === 'javascript' || language === 'typescript') {
            // Look for exports at the end of file
            for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i].trim();
                if (line.startsWith('export ') || line.startsWith('module.exports')) {
                    exports.unshift(lines[i]);
                } else if (exports.length > 0 && line === '') {
                    continue;
                } else if (exports.length > 0) {
                    break;
                }
            }
        }

        return exports;
    }

    private extractSymbolContent(lines: string[], startLine: number, language: string): string {
        const symbolLines: string[] = [];
        let braceCount = 0;
        let inSymbol = false;

        for (let i = startLine; i < lines.length && i < startLine + 50; i++) {
            const line = lines[i];
            symbolLines.push(line);

            // Simple brace counting for C-style languages
            if (['javascript', 'typescript', 'java', 'csharp', 'cpp'].includes(language)) {
                for (const char of line) {
                    if (char === '{') {
                        braceCount++;
                        inSymbol = true;
                    } else if (char === '}') {
                        braceCount--;
                    }
                }

                if (inSymbol && braceCount === 0) {
                    break;
                }
            } else if (language === 'python') {
                // For Python, use indentation
                if (i > startLine && line.trim() && !line.startsWith(' ') && !line.startsWith('\t')) {
                    symbolLines.pop(); // Remove the line that's not part of the symbol
                    break;
                }
            }
        }

        // If too long, truncate and add ellipsis
        if (symbolLines.length > 20) {
            return symbolLines.slice(0, 15).join('\n') + '\n    // ... (implementation details omitted) ...\n}';
        }

        return symbolLines.join('\n');
    }

    private async generateContextSummary(context: ContextWindow, query?: string): Promise<string> {
        const fileList = context.files.map(f => `- ${f.path} (${f.language}, ${f.tokens} tokens)`).join('\n');
        
        const prompt = `Summarize this code context in 2-3 sentences:

Files included:
${fileList}

${query ? `Query: ${query}` : ''}

Focus on: What functionality these files provide and how they relate to each other.`;

        try {
            return await this.preprocessor.summarizeFile(prompt, 'context');
        } catch (error) {
            return `Context includes ${context.files.length} files with ${context.totalTokens} total tokens.`;
        }
    }

    async createTaskContext(
        task: string,
        baseFiles: string[],
        options?: Partial<ContextOptions>
    ): Promise<ContextWindow> {
        // Search for additional relevant files
        const searchResults = await this.indexer.search(task);
        const additionalFiles = searchResults
            .slice(0, 10)
            .map(r => r.path)
            .filter(p => !baseFiles.includes(p));

        const allFiles = [...baseFiles, ...additionalFiles];
        
        return this.prepareContext(allFiles, options?.maxTokens || 100000, task, options);
    }

    async expandContext(
        currentContext: ContextWindow,
        symbol: string,
        maxAdditionalTokens: number
    ): Promise<ContextWindow> {
        // Find files that reference the symbol
        const references: string[] = [];
        
        for (const [filePath, fileIndex] of this.indexer['index'].files) {
            if (currentContext.files.some(f => f.path === filePath)) {
                continue; // Already in context
            }

            // Check if file references the symbol
            const hasReference = fileIndex.symbols.some(s => 
                s.name === symbol || s.references?.includes(symbol)
            );

            if (hasReference) {
                references.push(filePath);
            }
        }

        // Add references to context
        const expandedContext = { ...currentContext };
        let addedTokens = 0;

        for (const refPath of references) {
            if (addedTokens >= maxAdditionalTokens) break;

            const fileContext = await this.processFile(
                refPath,
                maxAdditionalTokens - addedTokens,
                symbol
            );

            if (fileContext) {
                expandedContext.files.push(fileContext);
                expandedContext.totalTokens += fileContext.tokens;
                addedTokens += fileContext.tokens;
            }
        }

        return expandedContext;
    }

    private estimateTokens(text: string): number {
        // Simple estimation - can be replaced with tiktoken for accuracy
        return Math.ceil(text.length / 4);
    }

    private getRelevance(_filePath: string): number {
        // Return stored relevance or default
        return 1.0; // Placeholder
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
}