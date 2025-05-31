import { PreprocessorManager } from '../managers/preprocessor';

export interface PromptTemplate {
    id: string;
    name: string;
    description: string;
    template: string;
    variables: PromptVariable[];
    examples: string[];
    category: 'refactoring' | 'feature' | 'bugfix' | 'analysis' | 'documentation' | 'testing';
}

export interface PromptVariable {
    name: string;
    description: string;
    type: 'string' | 'file' | 'symbol' | 'pattern';
    required: boolean;
    defaultValue?: string;
    suggestions?: string[];
}

export interface PromptSuggestion {
    type: 'clarification' | 'improvement' | 'warning' | 'template';
    message: string;
    severity: 'info' | 'warning' | 'error';
    fixes?: PromptFix[];
}

export interface PromptFix {
    label: string;
    newText: string;
    position?: { start: number; end: number };
}

export interface EnhancedPrompt {
    original: string;
    enhanced: string;
    suggestions: PromptSuggestion[];
    confidence: number;
    estimatedComplexity: 'simple' | 'moderate' | 'complex';
    recommendedModel?: 'preprocessor' | 'claude-sonnet' | 'claude-opus';
}

export class PromptAssistant {
    private templates: PromptTemplate[] = [
        {
            id: 'refactor-async',
            name: 'Refactor to Async/Await',
            description: 'Convert promise-based code to async/await',
            template: 'Refactor all promise-based code to use async/await syntax in {files}. {additionalInstructions}',
            variables: [
                {
                    name: 'files',
                    description: 'Files or directories to refactor',
                    type: 'file',
                    required: true,
                    suggestions: ['all files', 'src/', 'specific file.js']
                },
                {
                    name: 'additionalInstructions',
                    description: 'Any specific requirements',
                    type: 'string',
                    required: false,
                    defaultValue: 'Preserve error handling and maintain the same behavior'
                }
            ],
            examples: [
                'Refactor all promise-based code to use async/await syntax in src/api/. Preserve error handling and maintain the same behavior',
                'Refactor all promise-based code to use async/await syntax in userService.js. Add proper try-catch blocks'
            ],
            category: 'refactoring'
        },
        {
            id: 'add-tests',
            name: 'Add Unit Tests',
            description: 'Generate unit tests for existing code',
            template: 'Write comprehensive unit tests for {target} using {framework}. {coverage}',
            variables: [
                {
                    name: 'target',
                    description: 'Function, class, or file to test',
                    type: 'symbol',
                    required: true
                },
                {
                    name: 'framework',
                    description: 'Testing framework to use',
                    type: 'string',
                    required: true,
                    suggestions: ['Jest', 'Mocha', 'Vitest', 'pytest', 'JUnit']
                },
                {
                    name: 'coverage',
                    description: 'Coverage requirements',
                    type: 'string',
                    required: false,
                    defaultValue: 'Include edge cases and error scenarios'
                }
            ],
            examples: [
                'Write comprehensive unit tests for UserService class using Jest. Include edge cases and error scenarios',
                'Write comprehensive unit tests for auth.py using pytest. Test all public methods with mocking'
            ],
            category: 'testing'
        },
        {
            id: 'fix-type-errors',
            name: 'Fix TypeScript Errors',
            description: 'Resolve TypeScript compilation errors',
            template: 'Fix all TypeScript errors in {scope}. {approach}',
            variables: [
                {
                    name: 'scope',
                    description: 'Scope of fixes',
                    type: 'string',
                    required: true,
                    suggestions: ['the entire project', 'src/', 'specific module']
                },
                {
                    name: 'approach',
                    description: 'How to approach fixes',
                    type: 'string',
                    required: false,
                    defaultValue: 'Add proper types, avoid using any, maintain type safety'
                }
            ],
            examples: [
                'Fix all TypeScript errors in the entire project. Add proper types, avoid using any, maintain type safety',
                'Fix all TypeScript errors in src/components/. Use proper React types and interfaces'
            ],
            category: 'bugfix'
        },
        {
            id: 'optimize-performance',
            name: 'Optimize Performance',
            description: 'Improve code performance',
            template: 'Analyze and optimize performance in {area}. Focus on {metrics}. {constraints}',
            variables: [
                {
                    name: 'area',
                    description: 'Code area to optimize',
                    type: 'string',
                    required: true
                },
                {
                    name: 'metrics',
                    description: 'Performance metrics to improve',
                    type: 'string',
                    required: true,
                    suggestions: ['execution time', 'memory usage', 'bundle size', 'database queries']
                },
                {
                    name: 'constraints',
                    description: 'Any constraints or requirements',
                    type: 'string',
                    required: false,
                    defaultValue: 'Maintain backward compatibility and existing functionality'
                }
            ],
            examples: [
                'Analyze and optimize performance in data processing pipeline. Focus on execution time. Maintain backward compatibility',
                'Analyze and optimize performance in React components. Focus on re-renders and bundle size. Use React.memo where appropriate'
            ],
            category: 'refactoring'
        }
    ];

    private commonPatterns = {
        vague: [
            { pattern: /improve/i, suggestion: 'Specify what aspect to improve (performance, readability, maintainability)' },
            { pattern: /fix/i, suggestion: 'Describe what is broken or what specific issue to fix' },
            { pattern: /refactor/i, suggestion: 'Specify the refactoring goal (extract method, simplify logic, improve structure)' },
            { pattern: /optimize/i, suggestion: 'Define optimization targets (speed, memory, bundle size)' },
            { pattern: /clean up/i, suggestion: 'List specific cleanup tasks (remove dead code, fix formatting, organize imports)' }
        ],
        missing: [
            { check: (p: string) => !p.match(/\.(js|ts|py|java|cpp|rb|go|rs|cs|php)/), message: 'Consider specifying target files or file extensions' },
            { check: (p: string) => p.length < 30, message: 'Add more context about the current state and desired outcome' },
            { check: (p: string) => !p.match(/test|spec/i) && p.match(/add|create|implement/i), message: 'Mention if tests should be included' },
            { check: (p: string) => !p.match(/error|exception|catch|handle/i) && p.match(/refactor|change/i), message: 'Specify how to handle errors and edge cases' }
        ],
        complexity: [
            { keywords: ['entire', 'all', 'whole', 'every', 'complete'], weight: 2 },
            { keywords: ['refactor', 'redesign', 'rewrite', 'migrate'], weight: 3 },
            { keywords: ['and', 'also', 'plus', 'additionally'], weight: 1 },
            { keywords: ['analyze', 'optimize', 'improve'], weight: 2 },
            { keywords: ['file', 'function', 'method', 'class'], weight: -1 }
        ]
    };

    constructor(private preprocessor: PreprocessorManager) {}

    async analyzePrompt(prompt: string): Promise<EnhancedPrompt> {
        const suggestions: PromptSuggestion[] = [];
        
        // Check for vague terms
        for (const vague of this.commonPatterns.vague) {
            if (vague.pattern.test(prompt)) {
                suggestions.push({
                    type: 'clarification',
                    message: vague.suggestion,
                    severity: 'warning',
                    fixes: this.generateClarificationFixes(prompt, vague)
                });
            }
        }

        // Check for missing context
        for (const missing of this.commonPatterns.missing) {
            if (missing.check(prompt)) {
                suggestions.push({
                    type: 'improvement',
                    message: missing.message,
                    severity: 'info'
                });
            }
        }

        // Check for matching templates
        const matchingTemplates = this.findMatchingTemplates(prompt);
        for (const template of matchingTemplates) {
            suggestions.push({
                type: 'template',
                message: `Consider using the "${template.name}" template`,
                severity: 'info',
                fixes: [{
                    label: 'Use template',
                    newText: this.applyTemplate(template, prompt)
                }]
            });
        }

        // Get AI-powered suggestions if available
        if (this.preprocessor.isAvailable()) {
            try {
                const aiSuggestions = await this.preprocessor.suggestPromptImprovements(prompt);
                for (const suggestion of aiSuggestions) {
                    suggestions.push({
                        type: 'improvement',
                        message: suggestion,
                        severity: 'info'
                    });
                }
            } catch (error) {
                console.error('Failed to get AI suggestions:', error);
            }
        }

        // Calculate complexity
        const complexity = this.estimateComplexity(prompt);
        
        // Generate enhanced prompt
        const enhanced = await this.enhancePrompt(prompt, suggestions);

        return {
            original: prompt,
            enhanced,
            suggestions,
            confidence: this.calculateConfidence(prompt, suggestions),
            estimatedComplexity: complexity,
            recommendedModel: this.recommendModel(complexity, prompt)
        };
    }

    private findMatchingTemplates(prompt: string): PromptTemplate[] {
        const matches: { template: PromptTemplate; score: number }[] = [];
        const promptLower = prompt.toLowerCase();

        for (const template of this.templates) {
            let score = 0;

            // Check category keywords
            const categoryKeywords: { [key: string]: string[] } = {
                refactoring: ['refactor', 'convert', 'change', 'update', 'modify'],
                feature: ['add', 'implement', 'create', 'build', 'develop'],
                bugfix: ['fix', 'resolve', 'debug', 'repair', 'correct'],
                analysis: ['analyze', 'review', 'examine', 'inspect', 'audit'],
                documentation: ['document', 'comment', 'describe', 'explain'],
                testing: ['test', 'spec', 'coverage', 'unit', 'integration']
            };

            for (const keyword of categoryKeywords[template.category] || []) {
                if (promptLower.includes(keyword)) {
                    score += 2;
                }
            }

            // Check template-specific keywords
            const templateWords = template.name.toLowerCase().split(' ');
            for (const word of templateWords) {
                if (promptLower.includes(word)) {
                    score += 1;
                }
            }

            if (score > 2) {
                matches.push({ template, score });
            }
        }

        // Sort by score and return top 3
        return matches
            .sort((a, b) => b.score - a.score)
            .slice(0, 3)
            .map(m => m.template);
    }

    private applyTemplate(template: PromptTemplate, originalPrompt: string): string {
        let result = template.template;

        // Try to extract values from original prompt
        for (const variable of template.variables) {
            let value = variable.defaultValue || '';

            // Simple extraction logic - can be enhanced
            if (variable.type === 'file') {
                const fileMatch = originalPrompt.match(/(?:in|for|to)\s+(\S+\.(js|ts|py|java|cpp|rb|go|rs|cs|php))/);
                if (fileMatch) {
                    value = fileMatch[1];
                }
            }

            result = result.replace(`{${variable.name}}`, value || `[${variable.description}]`);
        }

        return result;
    }

    private async enhancePrompt(prompt: string, _suggestions: PromptSuggestion[]): Promise<string> {
        let enhanced = prompt;

        // Add context based on suggestions
        const additions: string[] = [];

        if (!prompt.match(/\.(js|ts|py|java|cpp|rb|go|rs|cs|php)/)) {
            additions.push('Target files: [specify files or use "all TypeScript files" or similar]');
        }

        if (prompt.match(/refactor|change|update/) && !prompt.match(/maintain|preserve|keep/)) {
            additions.push('Preserve existing functionality and maintain backward compatibility');
        }

        if (prompt.match(/performance|optimize/) && !prompt.match(/measure|metric|benchmark/)) {
            additions.push('Measure and report performance improvements');
        }

        if (additions.length > 0) {
            enhanced = `${prompt}\n\nAdditional requirements:\n${additions.map(a => `- ${a}`).join('\n')}`;
        }

        return enhanced;
    }

    private estimateComplexity(prompt: string): 'simple' | 'moderate' | 'complex' {
        let score = 0;
        const promptLower = prompt.toLowerCase();

        for (const item of this.commonPatterns.complexity) {
            for (const keyword of item.keywords) {
                if (promptLower.includes(keyword)) {
                    score += item.weight;
                }
            }
        }

        // Count number of tasks (and, also, plus)
        const taskCount = (prompt.match(/\b(and|also|plus|additionally)\b/gi) || []).length + 1;
        score += taskCount * 2;

        // Long prompts are usually more complex
        score += Math.floor(prompt.length / 100);

        if (score <= 3) return 'simple';
        if (score <= 8) return 'moderate';
        return 'complex';
    }

    private recommendModel(complexity: 'simple' | 'moderate' | 'complex', prompt: string): 'preprocessor' | 'claude-sonnet' | 'claude-opus' {
        // Simple heuristics for model recommendation
        if (complexity === 'simple' && !prompt.match(/create|implement|build/i)) {
            return 'preprocessor';
        }

        if (complexity === 'complex' || prompt.match(/entire|all|complete|comprehensive/i)) {
            return 'claude-opus';
        }

        return 'claude-sonnet';
    }

    private calculateConfidence(prompt: string, suggestions: PromptSuggestion[]): number {
        let confidence = 1.0;

        // Reduce confidence based on suggestions
        for (const suggestion of suggestions) {
            switch (suggestion.severity) {
                case 'error':
                    confidence -= 0.3;
                    break;
                case 'warning':
                    confidence -= 0.15;
                    break;
                case 'info':
                    confidence -= 0.05;
                    break;
            }
        }

        // Boost confidence for well-structured prompts
        if (prompt.length > 50) confidence += 0.1;
        if (prompt.match(/\.(js|ts|py|java|cpp|rb|go|rs|cs|php)/)) confidence += 0.1;
        if (prompt.match(/test|spec/i)) confidence += 0.05;

        return Math.max(0.1, Math.min(1.0, confidence));
    }

    private generateClarificationFixes(prompt: string, vague: any): PromptFix[] {
        const fixes: PromptFix[] = [];
        const match = prompt.match(vague.pattern);
        
        if (match) {
            const examples = this.getExamplesForVagueTerm(match[0]);
            for (const example of examples) {
                fixes.push({
                    label: example.label,
                    newText: prompt.replace(vague.pattern, example.replacement),
                    position: match.index ? { start: match.index, end: match.index + match[0].length } : undefined
                });
            }
        }

        return fixes;
    }

    private getExamplesForVagueTerm(term: string): { label: string; replacement: string }[] {
        const examples: { [key: string]: { label: string; replacement: string }[] } = {
            'improve': [
                { label: 'Improve performance', replacement: 'optimize for faster execution' },
                { label: 'Improve readability', replacement: 'refactor for better readability' },
                { label: 'Improve maintainability', replacement: 'restructure for easier maintenance' }
            ],
            'fix': [
                { label: 'Fix syntax errors', replacement: 'fix all syntax and compilation errors' },
                { label: 'Fix logic bugs', replacement: 'identify and fix logical errors' },
                { label: 'Fix type issues', replacement: 'resolve all type-related issues' }
            ],
            'refactor': [
                { label: 'Extract methods', replacement: 'refactor by extracting reusable methods' },
                { label: 'Simplify logic', replacement: 'refactor to simplify complex logic' },
                { label: 'Improve structure', replacement: 'refactor to improve code organization' }
            ]
        };

        return examples[term.toLowerCase()] || [];
    }

    getTemplates(category?: string): PromptTemplate[] {
        if (category) {
            return this.templates.filter(t => t.category === category);
        }
        return this.templates;
    }

    async createPromptFromTemplate(templateId: string, values: { [key: string]: string }): Promise<string> {
        const template = this.templates.find(t => t.id === templateId);
        if (!template) {
            throw new Error(`Template ${templateId} not found`);
        }

        let result = template.template;
        for (const variable of template.variables) {
            const value = values[variable.name] || variable.defaultValue || `[${variable.description}]`;
            result = result.replace(`{${variable.name}}`, value);
        }

        return result;
    }

    async validatePrompt(prompt: string): Promise<PromptSuggestion[]> {
        const analysis = await this.analyzePrompt(prompt);
        return analysis.suggestions.filter(s => s.severity === 'error' || s.severity === 'warning');
    }
}