import { PreprocessorManager } from '../managers/preprocessor';

export interface TaskPlan {
    summary: string;
    estimatedComplexity: 'simple' | 'moderate' | 'complex';
    estimatedDuration: number; // minutes
    requiredCapabilities: string[];
    risks: Risk[];
    dependencies: Dependency[];
    steps: PlannedStep[];
    rollbackStrategy?: string;
}

export interface PlannedStep {
    id: string;
    type: 'analyze' | 'edit' | 'test' | 'validate' | 'review';
    description: string;
    purpose: string;
    inputs: string[];
    outputs: string[];
    estimatedTokens: number;
    dependencies: string[]; // Step IDs this depends on
    canParallelize: boolean;
    riskLevel: 'low' | 'medium' | 'high';
    files?: string[];
    patterns?: string[];
    validation?: ValidationCriteria;
}

export interface Risk {
    description: string;
    severity: 'low' | 'medium' | 'high';
    mitigation: string;
}

export interface Dependency {
    type: 'file' | 'package' | 'service' | 'tool';
    name: string;
    required: boolean;
    available?: boolean;
}

export interface ValidationCriteria {
    type: 'syntax' | 'types' | 'tests' | 'lint' | 'build' | 'custom';
    command?: string;
    expectedOutcome?: string;
    errorTolerance?: number;
}

export class TaskPlanner {
    private planTemplates: Map<string, Partial<TaskPlan>> = new Map([
        ['refactor-async', {
            requiredCapabilities: ['ast-manipulation', 'promise-detection', 'error-handling'],
            risks: [
                {
                    description: 'Incorrect error handling transformation',
                    severity: 'high',
                    mitigation: 'Preserve try-catch blocks and error propagation patterns'
                },
                {
                    description: 'Breaking sequential execution',
                    severity: 'medium',
                    mitigation: 'Analyze promise chains for sequential dependencies'
                }
            ]
        }],
        ['add-tests', {
            requiredCapabilities: ['test-framework-knowledge', 'mocking', 'assertion-generation'],
            risks: [
                {
                    description: 'Incomplete test coverage',
                    severity: 'medium',
                    mitigation: 'Use coverage tools to identify gaps'
                },
                {
                    description: 'Brittle tests',
                    severity: 'low',
                    mitigation: 'Focus on behavior, not implementation details'
                }
            ]
        }],
        ['optimize-performance', {
            requiredCapabilities: ['profiling', 'complexity-analysis', 'algorithm-knowledge'],
            risks: [
                {
                    description: 'Premature optimization',
                    severity: 'medium',
                    mitigation: 'Profile first, optimize measurable bottlenecks'
                },
                {
                    description: 'Breaking functionality',
                    severity: 'high',
                    mitigation: 'Comprehensive testing before and after changes'
                }
            ]
        }]
    ]);

    constructor(private preprocessor: PreprocessorManager) {}

    async createPlan(
        taskDescription: string,
        codebaseInfo: any,
        _constraints?: any
    ): Promise<TaskPlan> {
        // First, use preprocessor to analyze the task
        const taskAnalysis = await this.analyzeTask(taskDescription);
        
        // Check for matching templates
        const template = this.findTemplate(taskDescription);
        
        // Create base plan structure
        const plan: TaskPlan = {
            summary: taskAnalysis.summary || taskDescription,
            estimatedComplexity: taskAnalysis.complexity || 'moderate',
            estimatedDuration: 0,
            requiredCapabilities: template?.requiredCapabilities || [],
            risks: template?.risks || [],
            dependencies: [],
            steps: []
        };

        // Generate steps based on task type
        const steps = await this.generateSteps(taskDescription, taskAnalysis, codebaseInfo);
        plan.steps = steps;

        // Calculate estimates
        plan.estimatedDuration = this.estimateDuration(steps);
        
        // Identify dependencies
        plan.dependencies = await this.identifyDependencies(steps, codebaseInfo);

        // Add rollback strategy for complex tasks
        if (plan.estimatedComplexity === 'complex') {
            plan.rollbackStrategy = await this.generateRollbackStrategy(steps);
        }

        // Validate and optimize plan
        return this.optimizePlan(plan);
    }

    private async analyzeTask(description: string): Promise<any> {
        if (!this.preprocessor.isAvailable()) {
            return this.basicTaskAnalysis(description);
        }

        try {
            const response = await this.preprocessor.analyzeCodebase(); // Use generic analysis
            return JSON.parse(response);
        } catch (error) {
            return this.basicTaskAnalysis(description);
        }
    }

    private basicTaskAnalysis(description: string): any {
        const complexityKeywords = {
            simple: ['fix', 'update', 'rename', 'move', 'add comment'],
            moderate: ['refactor', 'implement', 'integrate', 'optimize'],
            complex: ['redesign', 'migrate', 'rewrite', 'architect', 'all', 'entire']
        };

        let complexity: 'simple' | 'moderate' | 'complex' = 'moderate';
        const descLower = description.toLowerCase();

        for (const [level, keywords] of Object.entries(complexityKeywords)) {
            if (keywords.some(k => descLower.includes(k))) {
                complexity = level as any;
                break;
            }
        }

        return {
            summary: description,
            complexity,
            challenges: [],
            capabilities: this.inferCapabilities(description),
            risks: []
        };
    }

    private inferCapabilities(description: string): string[] {
        const capabilities: string[] = [];
        const descLower = description.toLowerCase();

        const capabilityMap = {
            'refactor': ['ast-manipulation', 'code-analysis'],
            'test': ['test-framework-knowledge', 'mocking'],
            'optimize': ['profiling', 'performance-analysis'],
            'async': ['promise-detection', 'async-patterns'],
            'type': ['type-inference', 'typescript'],
            'api': ['http-patterns', 'rest-conventions'],
            'database': ['sql-knowledge', 'orm-patterns'],
            'ui': ['component-patterns', 'dom-manipulation'],
            'security': ['vulnerability-detection', 'secure-coding']
        };

        for (const [keyword, caps] of Object.entries(capabilityMap)) {
            if (descLower.includes(keyword)) {
                capabilities.push(...caps);
            }
        }

        return [...new Set(capabilities)];
    }

    private async generateSteps(
        description: string,
        analysis: any,
        _codebaseInfo: any
    ): Promise<PlannedStep[]> {
        const steps: PlannedStep[] = [];
        
        // Always start with analysis
        steps.push({
            id: 'analyze-1',
            type: 'analyze',
            description: 'Analyze codebase structure and identify targets',
            purpose: 'Understand current state and plan changes',
            inputs: ['task description', 'codebase structure'],
            outputs: ['target files', 'change locations', 'impact analysis'],
            estimatedTokens: 5000,
            dependencies: [],
            canParallelize: false,
            riskLevel: 'low',
            patterns: this.extractPatterns(description)
        });

        // Add task-specific steps
        const taskSteps = await this.generateTaskSpecificSteps(description, analysis);
        steps.push(...taskSteps);

        // Add validation steps
        steps.push({
            id: `validate-${steps.length + 1}`,
            type: 'validate',
            description: 'Validate changes and ensure correctness',
            purpose: 'Verify changes don\'t break existing functionality',
            inputs: ['modified files', 'test results'],
            outputs: ['validation report', 'error list'],
            estimatedTokens: 3000,
            dependencies: steps.map(s => s.id),
            canParallelize: false,
            riskLevel: 'low',
            validation: {
                type: 'syntax',
                errorTolerance: 0
            }
        });

        // Add test running if needed
        if (description.toLowerCase().includes('test') || analysis.complexity !== 'simple') {
            steps.push({
                id: `test-${steps.length + 1}`,
                type: 'test',
                description: 'Run existing tests to verify changes',
                purpose: 'Ensure no regressions',
                inputs: ['test files', 'modified code'],
                outputs: ['test results', 'coverage report'],
                estimatedTokens: 1000,
                dependencies: [steps[steps.length - 1].id],
                canParallelize: false,
                riskLevel: 'medium',
                validation: {
                    type: 'tests',
                    command: 'npm test',
                    expectedOutcome: 'All tests pass'
                }
            });
        }

        return steps;
    }

    private async generateTaskSpecificSteps(
        description: string,
        _analysis: any
    ): Promise<PlannedStep[]> {
        const steps: PlannedStep[] = [];
        const descLower = description.toLowerCase();

        if (descLower.includes('refactor')) {
            steps.push(
                {
                    id: 'edit-refactor-1',
                    type: 'edit',
                    description: 'Apply refactoring patterns to identified code',
                    purpose: 'Transform code to new pattern while preserving behavior',
                    inputs: ['ast', 'refactoring rules'],
                    outputs: ['refactored code', 'change summary'],
                    estimatedTokens: 10000,
                    dependencies: ['analyze-1'],
                    canParallelize: true,
                    riskLevel: 'medium'
                },
                {
                    id: 'review-refactor-1',
                    type: 'review',
                    description: 'Review refactored code for correctness',
                    purpose: 'Ensure refactoring preserves original behavior',
                    inputs: ['original code', 'refactored code'],
                    outputs: ['review notes', 'approval status'],
                    estimatedTokens: 5000,
                    dependencies: ['edit-refactor-1'],
                    canParallelize: false,
                    riskLevel: 'low'
                }
            );
        }

        if (descLower.includes('implement') || descLower.includes('add')) {
            steps.push({
                id: 'edit-implement-1',
                type: 'edit',
                description: 'Implement new functionality',
                purpose: 'Add requested feature or component',
                inputs: ['requirements', 'integration points'],
                outputs: ['new code', 'updated files'],
                estimatedTokens: 15000,
                dependencies: ['analyze-1'],
                canParallelize: false,
                riskLevel: 'medium'
            });
        }

        if (descLower.includes('optimize')) {
            steps.push(
                {
                    id: 'analyze-performance-1',
                    type: 'analyze',
                    description: 'Profile and identify performance bottlenecks',
                    purpose: 'Find areas that need optimization',
                    inputs: ['code', 'performance metrics'],
                    outputs: ['bottleneck list', 'optimization opportunities'],
                    estimatedTokens: 8000,
                    dependencies: ['analyze-1'],
                    canParallelize: false,
                    riskLevel: 'low'
                },
                {
                    id: 'edit-optimize-1',
                    type: 'edit',
                    description: 'Apply optimization techniques',
                    purpose: 'Improve performance in identified areas',
                    inputs: ['bottleneck analysis', 'optimization patterns'],
                    outputs: ['optimized code', 'performance comparison'],
                    estimatedTokens: 12000,
                    dependencies: ['analyze-performance-1'],
                    canParallelize: true,
                    riskLevel: 'high'
                }
            );
        }

        return steps;
    }

    private extractPatterns(description: string): string[] {
        const patterns: string[] = [];
        const descLower = description.toLowerCase();

        const patternMap = {
            'promise': ['new Promise', '.then(', '.catch(', 'async', 'await'],
            'callback': ['callback', 'cb(', 'done(', 'next('],
            'error': ['try', 'catch', 'throw', 'Error'],
            'loop': ['for', 'while', 'forEach', 'map', 'reduce'],
            'import': ['import', 'require', 'from'],
            'class': ['class', 'extends', 'constructor'],
            'function': ['function', '=>', 'async'],
            'test': ['test(', 'it(', 'describe(', 'expect(']
        };

        for (const [key, values] of Object.entries(patternMap)) {
            if (descLower.includes(key)) {
                patterns.push(...values);
            }
        }

        return [...new Set(patterns)];
    }

    private findTemplate(description: string): Partial<TaskPlan> | undefined {
        const descLower = description.toLowerCase();
        
        for (const [key, template] of this.planTemplates) {
            if (descLower.includes(key.replace('-', ' '))) {
                return template;
            }
        }

        return undefined;
    }

    private estimateDuration(steps: PlannedStep[]): number {
        let totalMinutes = 0;

        for (const step of steps) {
            // Rough estimates based on step type and complexity
            const baseTime = {
                'analyze': 2,
                'edit': 5,
                'test': 3,
                'validate': 2,
                'review': 3
            }[step.type] || 3;

            const complexityMultiplier = {
                'low': 1,
                'medium': 1.5,
                'high': 2
            }[step.riskLevel];

            totalMinutes += baseTime * complexityMultiplier;
        }

        return Math.ceil(totalMinutes);
    }

    private async identifyDependencies(
        steps: PlannedStep[],
        _codebaseInfo: any
    ): Promise<Dependency[]> {
        const dependencies: Dependency[] = [];
        const seen = new Set<string>();

        // Check for testing framework
        if (steps.some(s => s.type === 'test')) {
            dependencies.push({
                type: 'package',
                name: 'jest', // Or detect from package.json
                required: true,
                available: true // Check package.json
            });
        }

        // Check for build tools
        if (steps.some(s => s.validation?.type === 'build')) {
            dependencies.push({
                type: 'tool',
                name: 'typescript',
                required: true,
                available: true // Check if tsc is available
            });
        }

        // Add linting tools
        if (steps.some(s => s.validation?.type === 'lint')) {
            dependencies.push({
                type: 'package',
                name: 'eslint',
                required: false,
                available: true
            });
        }

        return dependencies.filter(d => {
            const key = `${d.type}:${d.name}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    private async generateRollbackStrategy(steps: PlannedStep[]): Promise<string> {
        const editSteps = steps.filter(s => s.type === 'edit');
        
        if (editSteps.length === 0) {
            return 'No file modifications planned - no rollback needed';
        }

        return `Rollback Strategy:
1. Git stash or commit current changes before starting
2. Create backup of files: ${editSteps.length} files will be modified
3. If issues arise, restore from git: 'git checkout -- .'
4. For partial rollback, use git diff to review and selectively revert
5. Keep detailed log of changes for manual rollback if needed`;
    }

    private optimizePlan(plan: TaskPlan): TaskPlan {
        // Identify steps that can be parallelized
        const parallelGroups = this.findParallelGroups(plan.steps);
        
        // Reorder steps for efficiency
        const optimizedSteps = this.reorderSteps(plan.steps, parallelGroups);
        
        // Update dependencies after reordering
        this.updateDependencies(optimizedSteps);
        
        return {
            ...plan,
            steps: optimizedSteps
        };
    }

    private findParallelGroups(steps: PlannedStep[]): Map<string, string[]> {
        const groups = new Map<string, string[]>();
        
        for (const step of steps) {
            if (step.canParallelize && step.dependencies.length > 0) {
                const key = step.dependencies.sort().join(',');
                if (!groups.has(key)) {
                    groups.set(key, []);
                }
                groups.get(key)!.push(step.id);
            }
        }

        return groups;
    }

    private reorderSteps(
        steps: PlannedStep[],
        parallelGroups: Map<string, string[]>
    ): PlannedStep[] {
        const reordered: PlannedStep[] = [];
        const processed = new Set<string>();

        // Topological sort with parallel group consideration
        const visit = (step: PlannedStep) => {
            if (processed.has(step.id)) return;

            // Process dependencies first
            for (const depId of step.dependencies) {
                const dep = steps.find(s => s.id === depId);
                if (dep && !processed.has(depId)) {
                    visit(dep);
                }
            }

            // Add this step
            reordered.push(step);
            processed.add(step.id);

            // Add parallel siblings
            for (const [_, group] of parallelGroups) {
                if (group.includes(step.id)) {
                    for (const siblingId of group) {
                        if (!processed.has(siblingId)) {
                            const sibling = steps.find(s => s.id === siblingId)!;
                            reordered.push(sibling);
                            processed.add(siblingId);
                        }
                    }
                }
            }
        };

        // Start with steps that have no dependencies
        for (const step of steps) {
            if (step.dependencies.length === 0) {
                visit(step);
            }
        }

        // Add any remaining steps
        for (const step of steps) {
            visit(step);
        }

        return reordered;
    }

    private updateDependencies(steps: PlannedStep[]): void {
        // Ensure dependencies reference valid step IDs after reordering
        const stepIds = new Set(steps.map(s => s.id));
        
        for (const step of steps) {
            step.dependencies = step.dependencies.filter(d => stepIds.has(d));
        }
    }

    async validatePlan(plan: TaskPlan, constraints: any): Promise<{ valid: boolean; issues: string[] }> {
        const issues: string[] = [];

        // Check token limits
        const totalTokens = plan.steps.reduce((sum, step) => sum + step.estimatedTokens, 0);
        if (totalTokens > (constraints.maxTokens || 200000)) {
            issues.push(`Plan requires ${totalTokens} tokens, exceeding limit`);
        }

        // Check required capabilities
        const missingCapabilities = plan.requiredCapabilities.filter(
            cap => !constraints.availableCapabilities?.includes(cap)
        );
        if (missingCapabilities.length > 0) {
            issues.push(`Missing capabilities: ${missingCapabilities.join(', ')}`);
        }

        // Check dependencies
        const unavailableDeps = plan.dependencies.filter(d => d.required && !d.available);
        if (unavailableDeps.length > 0) {
            issues.push(`Missing dependencies: ${unavailableDeps.map(d => d.name).join(', ')}`);
        }

        // Check for circular dependencies in steps
        if (this.hasCircularDependencies(plan.steps)) {
            issues.push('Plan contains circular dependencies');
        }

        return {
            valid: issues.length === 0,
            issues
        };
    }

    private hasCircularDependencies(steps: PlannedStep[]): boolean {
        const visited = new Set<string>();
        const recursionStack = new Set<string>();

        const hasCycle = (stepId: string): boolean => {
            visited.add(stepId);
            recursionStack.add(stepId);

            const step = steps.find(s => s.id === stepId);
            if (step) {
                for (const depId of step.dependencies) {
                    if (!visited.has(depId)) {
                        if (hasCycle(depId)) return true;
                    } else if (recursionStack.has(depId)) {
                        return true;
                    }
                }
            }

            recursionStack.delete(stepId);
            return false;
        };

        for (const step of steps) {
            if (!visited.has(step.id)) {
                if (hasCycle(step.id)) return true;
            }
        }

        return false;
    }
}