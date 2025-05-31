import * as vscode from 'vscode';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Ollama } from 'ollama';
import OpenAI from 'openai';

export interface PreprocessorModel {
    id: string;
    name: string;
    type: 'gemini' | 'ollama' | 'llamafile' | 'openai-compatible';
    capabilities: ModelCapabilities;
    config: ModelConfig;
}

export interface ModelCapabilities {
    embedding: boolean;
    summarization: boolean;
    codeAnalysis: boolean;
    contextSize: number;
    costPerMillion?: number; // For tracking free tier limits
}

export interface ModelConfig {
    apiKey?: string;
    endpoint?: string;
    modelName?: string;
    temperature?: number;
    maxTokens?: number;
}

export interface RankingResult {
    file: string;
    score: number;
    reason: string;
}

export class PreprocessorManager {
    private currentModel: PreprocessorModel | null = null;
    private geminiClient: GoogleGenerativeAI | null = null;
    private ollamaClient: Ollama | null = null;
    private openaiClient: OpenAI | null = null;
    private usageTracker: Map<string, number> = new Map();

    private models: PreprocessorModel[] = [
        {
            id: 'gemini-1.5-pro',
            name: 'Google Gemini 1.5 Pro',
            type: 'gemini',
            capabilities: {
                embedding: true,
                summarization: true,
                codeAnalysis: true,
                contextSize: 1000000, // 1M context window
                costPerMillion: 0 // Free tier available
            },
            config: {}
        },
        {
            id: 'llama3',
            name: 'Llama 3 (via Ollama)',
            type: 'ollama',
            capabilities: {
                embedding: true,
                summarization: true,
                codeAnalysis: true,
                contextSize: 8192,
                costPerMillion: 0 // Local
            },
            config: {
                endpoint: 'http://localhost:11434',
                modelName: 'llama3'
            }
        },
        {
            id: 'codellama',
            name: 'Code Llama (via Ollama)',
            type: 'ollama',
            capabilities: {
                embedding: true,
                summarization: true,
                codeAnalysis: true,
                contextSize: 16384,
                costPerMillion: 0 // Local
            },
            config: {
                endpoint: 'http://localhost:11434',
                modelName: 'codellama'
            }
        },
        {
            id: 'local-ollama',
            name: 'Custom Ollama Model',
            type: 'ollama',
            capabilities: {
                embedding: true,
                summarization: true,
                codeAnalysis: true,
                contextSize: 8192,
                costPerMillion: 0
            },
            config: {
                endpoint: 'http://localhost:11434'
            }
        }
    ];

    constructor(private context: vscode.ExtensionContext) {
        this.loadConfiguration();
    }

    private async loadConfiguration() {
        const config = vscode.workspace.getConfiguration('ai-code-agent');
        const modelId = config.get<string>('preprocessorModel') || 'llama3';
        
        const model = this.models.find(m => m.id === modelId);
        if (model) {
            await this.initializeModel(model);
        }
    }

    async configureModel(modelId: string): Promise<void> {
        const model = this.models.find(m => m.id === modelId);
        if (!model) {
            throw new Error(`Unknown model: ${modelId}`);
        }

        await this.initializeModel(model);
        
        // Update configuration
        const config = vscode.workspace.getConfiguration('ai-code-agent');
        await config.update('preprocessorModel', modelId, vscode.ConfigurationTarget.Global);
    }

    private async initializeModel(model: PreprocessorModel): Promise<void> {
        this.currentModel = model;

        switch (model.type) {
            case 'gemini':
                const geminiKey = await this.context.secrets.get('gemini-api-key');
                if (geminiKey) {
                    this.geminiClient = new GoogleGenerativeAI(geminiKey);
                }
                break;
                
            case 'ollama':
                this.ollamaClient = new Ollama({
                    host: model.config.endpoint || 'http://localhost:11434'
                });
                // Test connection
                try {
                    await this.ollamaClient.list();
                } catch (error) {
                    vscode.window.showWarningMessage(
                        `Cannot connect to Ollama at ${model.config.endpoint}. Please ensure Ollama is running.`
                    );
                }
                break;
                
            case 'openai-compatible':
                const apiKey = await this.context.secrets.get(`${model.id}-api-key`);
                if (apiKey && model.config.endpoint) {
                    this.openaiClient = new OpenAI({
                        apiKey,
                        baseURL: model.config.endpoint
                    });
                }
                break;
        }
    }

    async setApiKey(service: string, key: string): Promise<void> {
        await this.context.secrets.store(`${service}-api-key`, key);
        
        if (this.currentModel && this.currentModel.type === service) {
            await this.initializeModel(this.currentModel);
        }
    }

    async setEndpoint(service: string, endpoint: string): Promise<void> {
        if (this.currentModel && this.currentModel.id.includes(service)) {
            this.currentModel.config.endpoint = endpoint;
            await this.initializeModel(this.currentModel);
        }
    }

    isAvailable(): boolean {
        if (!this.currentModel) return false;

        switch (this.currentModel.type) {
            case 'gemini':
                return this.geminiClient !== null;
            case 'ollama':
                return this.ollamaClient !== null;
            case 'openai-compatible':
                return this.openaiClient !== null;
            default:
                return false;
        }
    }

    supportsEmbeddings(): boolean {
        return this.currentModel?.capabilities.embedding || false;
    }

    async analyzeCodebase(): Promise<any> {
        if (!this.isAvailable()) {
            return { error: 'No preprocessor model available' };
        }

        const prompt = `Analyze this codebase structure and provide insights:
        - Main programming languages used
        - Project type and architecture
        - Key dependencies and frameworks
        - Overall code organization
        - Suggested areas for improvement`;

        return await this.callModel(prompt, 'analysis');
    }

    async rankRelevantFiles(files: string[], query: string): Promise<RankingResult[]> {
        if (!this.isAvailable()) {
            // Fallback to simple ranking
            return files.map(file => ({
                file,
                score: file.toLowerCase().includes(query.toLowerCase()) ? 1.0 : 0.5,
                reason: 'Filename match'
            }));
        }

        const prompt = `Given this task: "${query}"
        
Rank these files by relevance (most relevant first):
${files.map((f, i) => `${i + 1}. ${f}`).join('\n')}

For each file, provide:
1. Relevance score (0-1)
2. Brief reason why it's relevant or not

Return as JSON array: [{"file": "path", "score": 0.9, "reason": "..."}]`;

        try {
            const response = await this.callModel(prompt, 'ranking');
            return JSON.parse(response);
        } catch (error) {
            console.error('Failed to rank files:', error);
            return files.map(file => ({
                file,
                score: 0.5,
                reason: 'Error during ranking'
            }));
        }
    }

    async summarizeFile(content: string, language: string): Promise<string> {
        if (!this.isAvailable()) {
            return 'File summary not available';
        }

        const prompt = `Summarize this ${language} code file in 2-3 sentences:
- What is its main purpose?
- What are the key functions/classes?
- What dependencies does it have?

Code:
${content.substring(0, 3000)}${content.length > 3000 ? '\n... (truncated)' : ''}`;

        return await this.callModel(prompt, 'summarization');
    }

    async generateEmbedding(text: string): Promise<number[]> {
        if (!this.isAvailable() || !this.supportsEmbeddings()) {
            // Return a simple hash-based embedding as fallback
            return this.simpleEmbedding(text);
        }

        try {
            switch (this.currentModel!.type) {
                case 'gemini':
                    if (this.geminiClient) {
                        const model = this.geminiClient.getGenerativeModel({ 
                            model: 'embedding-001' 
                        });
                        const result = await model.embedContent(text);
                        return result.embedding.values;
                    }
                    break;
                    
                case 'ollama':
                    if (this.ollamaClient) {
                        const response = await this.ollamaClient.embeddings({
                            model: this.currentModel!.config.modelName || 'llama3',
                            prompt: text
                        });
                        return response.embedding;
                    }
                    break;
            }
        } catch (error) {
            console.error('Embedding generation failed:', error);
        }

        return this.simpleEmbedding(text);
    }

    async analyzeFiles(files: string[]): Promise<any> {
        if (!this.isAvailable()) {
            return { files: files.length, analyzed: false };
        }

        const results: any[] = [];
        
        for (const file of files) {
            try {
                const uri = vscode.Uri.file(file);
                const content = await vscode.workspace.fs.readFile(uri);
                const text = Buffer.from(content).toString('utf8');
                
                const analysis = await this.analyzeCode(text.substring(0, 5000));
                results.push({ file, ...analysis });
            } catch (error) {
                results.push({ file, error: error instanceof Error ? error.message : 'Unknown error' });
            }
        }

        return { files: results };
    }

    private async analyzeCode(code: string): Promise<any> {
        const prompt = `Analyze this code and identify:
1. Main functionality
2. Code quality issues
3. Potential bugs or improvements
4. Dependencies and imports

Code:
${code}

Return as JSON with these fields: {functionality, issues, improvements, dependencies}`;

        try {
            const response = await this.callModel(prompt, 'code-analysis');
            return JSON.parse(response);
        } catch (error) {
            return {
                functionality: 'Analysis failed',
                issues: [],
                improvements: [],
                dependencies: []
            };
        }
    }

    async suggestPromptImprovements(prompt: string): Promise<string[]> {
        if (!this.isAvailable()) {
            return this.basicPromptSuggestions(prompt);
        }

        const improvePrompt = `Analyze this coding task prompt and suggest improvements:
"${prompt}"

Provide 3-5 specific suggestions to make the prompt clearer and more actionable.
Consider:
- Ambiguous terms that need clarification
- Missing context or constraints
- Specific files or areas to focus on
- Expected output format
- Edge cases to handle

Return as JSON array of strings.`;

        try {
            const response = await this.callModel(improvePrompt, 'prompt-improvement');
            return JSON.parse(response);
        } catch (error) {
            return this.basicPromptSuggestions(prompt);
        }
    }

    private basicPromptSuggestions(prompt: string): string[] {
        const suggestions: string[] = [];
        
        if (prompt.length < 20) {
            suggestions.push('Add more detail about what you want to accomplish');
        }
        
        if (!prompt.includes('file') && !prompt.includes('function') && !prompt.includes('class')) {
            suggestions.push('Specify which files, functions, or classes to modify');
        }
        
        if (!prompt.includes('test')) {
            suggestions.push('Consider mentioning if tests should be updated');
        }
        
        if (prompt.includes('refactor') || prompt.includes('change')) {
            suggestions.push('Specify the current state and desired end state');
        }

        return suggestions;
    }

    private async callModel(prompt: string, purpose: string): Promise<string> {
        this.trackUsage(purpose);

        try {
            switch (this.currentModel!.type) {
                case 'gemini':
                    return await this.callGemini(prompt);
                    
                case 'ollama':
                    return await this.callOllama(prompt);
                    
                case 'openai-compatible':
                    return await this.callOpenAICompatible(prompt);
                    
                default:
                    throw new Error('Model not implemented');
            }
        } catch (error) {
            console.error(`Model call failed for ${purpose}:`, error);
            throw error;
        }
    }

    private async callGemini(prompt: string): Promise<string> {
        if (!this.geminiClient) {
            throw new Error('Gemini client not initialized');
        }

        const model = this.geminiClient.getGenerativeModel({ 
            model: 'gemini-1.5-pro' 
        });
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    }

    private async callOllama(prompt: string): Promise<string> {
        if (!this.ollamaClient) {
            throw new Error('Ollama client not initialized');
        }

        const response = await this.ollamaClient.generate({
            model: this.currentModel!.config.modelName || 'llama3',
            prompt,
            stream: false,
            options: {
                temperature: this.currentModel!.config.temperature || 0.3,
                num_predict: this.currentModel!.config.maxTokens || 2048
            }
        });

        return response.response;
    }

    private async callOpenAICompatible(prompt: string): Promise<string> {
        if (!this.openaiClient) {
            throw new Error('OpenAI-compatible client not initialized');
        }

        const response = await this.openaiClient.chat.completions.create({
            model: this.currentModel!.config.modelName || 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: prompt }],
            temperature: this.currentModel!.config.temperature || 0.3,
            max_tokens: this.currentModel!.config.maxTokens || 2048
        });

        return response.choices[0].message.content || '';
    }

    private simpleEmbedding(text: string): number[] {
        // Simple hash-based embedding for fallback
        const embedding = new Array(384).fill(0);
        const words = text.toLowerCase().split(/\s+/);
        
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            for (let j = 0; j < word.length; j++) {
                const idx = (word.charCodeAt(j) * (i + 1) * (j + 1)) % embedding.length;
                embedding[idx] += 1 / (words.length * word.length);
            }
        }

        // Normalize
        const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
        return embedding.map(val => val / (magnitude || 1));
    }

    private trackUsage(purpose: string) {
        const key = `${this.currentModel?.id}:${purpose}`;
        this.usageTracker.set(key, (this.usageTracker.get(key) || 0) + 1);
    }

    getUsageStats(): any {
        const stats: any = {};
        
        for (const [key, count] of this.usageTracker) {
            const [model, purpose] = key.split(':');
            if (!stats[model]) {
                stats[model] = {};
            }
            stats[model][purpose] = count;
        }

        return stats;
    }

    updateConfiguration(): void {
        this.loadConfiguration();
    }
}