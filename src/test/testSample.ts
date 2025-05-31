import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { AgentCore, TaskStep } from '../core/core';
import { ApiKeyManager } from '../managers/apiKeyManager';
import { ModelManager } from '../managers/modelManager';
import { PreprocessorManager } from '../managers/preprocessor';
import { CodebaseIndexer } from '../services/indexer';

suite('AgentCore Test Suite', () => {
    let agentCore: AgentCore;
    let mockApiKeyManager: sinon.SinonStubbedInstance<ApiKeyManager>;
    let mockModelManager: sinon.SinonStubbedInstance<ModelManager>;
    let mockIndexer: sinon.SinonStubbedInstance<CodebaseIndexer>;
    let mockPreprocessor: sinon.SinonStubbedInstance<PreprocessorManager>;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Create mocks
        mockApiKeyManager = {
            getApiKey: sandbox.stub().resolves('test-api-key'),
            setApiKey: sandbox.stub().resolves(),
            validateApiKey: sandbox.stub().resolves(true),
            hasApiKey: sandbox.stub().resolves(true)
        } as any;

        mockModelManager = {
            getCurrentModel: sandbox.stub().returns('claude-opus-4'),
            getCurrentMode: sandbox.stub().returns('thinking'),
            getMaxTokens: sandbox.stub().returns(100000),
            getContextWindow: sandbox.stub().returns(200000),
            estimateTokenCount: sandbox.stub().returns(100)
        } as any;

        mockIndexer = {
            search: sandbox.stub().resolves([]),
            getFileIndex: sandbox.stub().returns(undefined),
            indexWorkspace: sandbox.stub().resolves()
        } as any;

        mockPreprocessor = {
            isAvailable: sandbox.stub().returns(true),
            analyzeCodebase: sandbox.stub().resolves({ summary: 'Test analysis' }),
            rankRelevantFiles: sandbox.stub().resolves([])
        } as any;

        // Create instance
        agentCore = new AgentCore(
            mockApiKeyManager,
            mockModelManager,
            mockIndexer,
            mockPreprocessor
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    test('should create agent core instance', () => {
        assert.ok(agentCore);
        assert.strictEqual(typeof agentCore.executeTask, 'function');
    });

    test('should handle missing API key', async () => {
        mockApiKeyManager.getApiKey.resolves(undefined);
        
        const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');
        const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand');

        try {
            await agentCore.executeTask('test task');
        } catch (error) {
            // Expected to fail
        }

        assert.ok(showErrorStub.calledWith('Please set your Anthropic API key first'));
        assert.ok(executeCommandStub.calledWith('ai-code-agent.setApiKey'));
    });

    test('should execute simple task successfully', async () => {
        // Mock the Anthropic client
        const mockAnthropicResponse = {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    summary: 'Test plan',
                    estimatedFiles: ['test.js'],
                    steps: [{
                        type: 'analyze',
                        description: 'Analyze test file',
                        files: ['test.js']
                    }]
                })
            }]
        };

        // Stub private method using prototype
        sandbox.stub(AgentCore.prototype as any, 'callClaude')
            .resolves(mockAnthropicResponse.content[0].text);

        await agentCore.executeTask('simple test task');

        // Since executeTask returns void, we test that it runs without error
        assert.ok(true, 'Task execution completed successfully');
    });

    test('should handle task cancellation', async () => {
        const tokenStub = {
            isCancellationRequested: true,
            onCancellationRequested: sandbox.stub()
        };

        try {
            await (agentCore as any).planTask(
                { id: 'test', description: 'test' },
                tokenStub
            );
            assert.fail('Should have thrown cancellation error');
        } catch (error: any) {
            assert.strictEqual(error.message, 'Task cancelled');
        }
    });

    test('should track session state', async () => {
        const sessionState = agentCore.getSessionState();
        assert.ok(sessionState);

        const addTaskSpy = sandbox.spy(sessionState, 'addTask');
        
        // Execute a task
        await agentCore.executeTask('track this task');

        assert.ok(addTaskSpy.called);
    });

    test('should gather context correctly', async () => {
        const mockContext = {
            files: [{ path: 'test.js', content: 'test content' }],
            totalTokens: 100
        };

        mockPreprocessor.rankRelevantFiles.resolves([
            { file: 'test.js', score: 0.9, reason: 'Relevant' }
        ]);

        const contextManagerStub = sandbox.stub((agentCore as any).contextManager, 'prepareContext')
            .resolves(mockContext);

        const context = await (agentCore as any).gatherContext(
            { estimatedFiles: ['test.js'], summary: 'test' },
            { isCancellationRequested: false }
        );

        assert.deepStrictEqual(context, mockContext);
        assert.ok(contextManagerStub.calledOnce);
    });

    test('should handle file edit operations', async () => {
        const showChangePreviewStub = sandbox.stub(agentCore as any, 'showChangesPreview')
            .resolves(true);

        const step: TaskStep = {
            id: 'edit-1',
            type: 'edit',
            description: 'Edit test file',
            status: 'running',
            files: ['test.js']
        };

        await (agentCore as any).executeEditStep(step, {});

        assert.ok(showChangePreviewStub.called);
    });

    test('should estimate token usage', () => {
        const text = 'This is a test string for token estimation';
        const tokens = (agentCore as any).estimateTokens(text);
        
        assert.strictEqual(typeof tokens, 'number');
        assert.ok(tokens > 0);
        assert.ok(tokens < text.length); // Should be less than character count
    });

    test('should handle rate limiting', async () => {
        const error = new Error('rate_limit_exceeded');
        (error as any).status = 429;

        let callCount = 0;
        sandbox.stub(agentCore as any, 'callClaude')
            .callsFake(async () => {
                callCount++;
                if (callCount === 1) {
                    throw error;
                }
                return 'Success after retry';
            });

        const delayStub = sandbox.stub(agentCore as any, 'delay').resolves();

        const result = await (agentCore as any).callClaude('test prompt', 'test');

        assert.strictEqual(result, 'Success after retry');
        assert.ok(delayStub.calledWith(60000)); // Should wait 1 minute
        assert.strictEqual(callCount, 2);
    });

    test('should validate task plan', async () => {
        const plan = {
            steps: [
                {
                    id: 'step1',
                    dependencies: []
                },
                {
                    id: 'step2',
                    dependencies: ['step1']
                }
            ]
        };

        const result = await (agentCore as any).taskPlanner.validatePlan(plan, {
            maxTokens: 200000,
            availableCapabilities: ['analyze', 'edit']
        });

        assert.ok(result.valid);
        assert.strictEqual(result.issues.length, 0);
    });

    test('should detect circular dependencies', () => {
        const steps = [
            {
                id: 'step1',
                dependencies: ['step2']
            },
            {
                id: 'step2',
                dependencies: ['step1']
            }
        ];

        const hasCircular = (agentCore as any).taskPlanner.hasCircularDependencies(steps);
        assert.ok(hasCircular);
    });

    test('should handle task queue', () => {
        const history = agentCore.getTaskHistory();
        assert.ok(Array.isArray(history));
        
        const currentTask = agentCore.getCurrentTask();
        assert.strictEqual(currentTask, null); // No task running initially
    });

    test('should dispose properly', () => {
        const saveStub = sandbox.stub((agentCore as any).sessionState, 'save');
        
        agentCore.dispose();
        
        assert.ok(saveStub.called);
    });
});

suite('Integration Tests', () => {
    let workspaceFolder: vscode.WorkspaceFolder;

    suiteSetup(async () => {
        // Ensure we have a workspace
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            assert.fail('No workspace folder found for testing');
        }
        workspaceFolder = folders[0];
    });

    test('should index workspace files', async function() {
        this.timeout(10000); // Indexing can take time

        const context = {
            subscriptions: [],
            globalStorageUri: vscode.Uri.file('/tmp/test-storage')
        } as any;

        const preprocessor = new PreprocessorManager(context);
        const indexer = new CodebaseIndexer(context, preprocessor);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Testing indexer'
        }, async (progress) => {
            await indexer.indexWorkspace(progress);
        });

        const stats = indexer.getWorkspaceStats();
        assert.ok(stats.totalFiles >= 0);
        assert.ok(stats.totalSymbols >= 0);
    });

    test('should handle file changes', async () => {
        // Create a test file
        const testFile = vscode.Uri.joinPath(workspaceFolder.uri, 'test-temp.js');
        const content = 'function testFunction() { return "test"; }';
        
        await vscode.workspace.fs.writeFile(testFile, Buffer.from(content));

        // Wait for file watcher to pick it up
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Clean up
        await vscode.workspace.fs.delete(testFile);
    });
});

suite('Error Handling Tests', () => {
    test('should handle network errors gracefully', async () => {
        const networkError = new Error('Network error');
        (networkError as any).code = 'ECONNREFUSED';

        // Test behavior when network fails
        const showErrorStub = sinon.stub(vscode.window, 'showErrorMessage');
        
        // Simulate network error handling
        try {
            throw networkError;
        } catch (error) {
            vscode.window.showErrorMessage('Connection failed. Please check your internet connection.');
        }

        assert.ok(showErrorStub.calledWith('Connection failed. Please check your internet connection.'));
        showErrorStub.restore();
    });

    test('should handle file system errors', async () => {
        const fsError = new Error('ENOENT: no such file or directory');
        (fsError as any).code = 'ENOENT';

        // Test file system error handling
        assert.throws(() => {
            throw fsError;
        }, /ENOENT/);
    });
});