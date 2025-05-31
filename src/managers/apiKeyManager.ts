import * as vscode from 'vscode';

export class ApiKeyManager {
    private static readonly ANTHROPIC_KEY = 'anthropic-api-key';
    private static readonly KEY_PREFIX = 'ai-code-agent';

    constructor(private context: vscode.ExtensionContext) {}

    async setApiKey(key: string): Promise<void> {
        try {
            await this.context.secrets.store(`${ApiKeyManager.KEY_PREFIX}.${ApiKeyManager.ANTHROPIC_KEY}`, key);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to store API key: ${error}`);
            throw error;
        }
    }

    async getApiKey(): Promise<string | undefined> {
        try {
            return await this.context.secrets.get(`${ApiKeyManager.KEY_PREFIX}.${ApiKeyManager.ANTHROPIC_KEY}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to retrieve API key: ${error}`);
            return undefined;
        }
    }

    async deleteApiKey(): Promise<void> {
        try {
            await this.context.secrets.delete(`${ApiKeyManager.KEY_PREFIX}.${ApiKeyManager.ANTHROPIC_KEY}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete API key: ${error}`);
            throw error;
        }
    }

    async validateApiKey(key?: string): Promise<boolean> {
        const apiKey = key || await this.getApiKey();
        
        if (!apiKey) {
            return false;
        }

        // Basic format validation for Anthropic keys
        const anthropicKeyPattern = /^sk-ant-[a-zA-Z0-9]{40,}$/;
        
        if (!anthropicKeyPattern.test(apiKey)) {
            vscode.window.showWarningMessage('Invalid API key format');
            return false;
        }

        // Test the key with a minimal API call
        try {
            const Anthropic = require('@anthropic-ai/sdk').default;
            const client = new Anthropic({ apiKey });
            
            // Make a minimal request to validate the key
            await client.messages.create({
                model: 'claude-3-sonnet-20240229',
                max_tokens: 1,
                messages: [{ role: 'user', content: 'test' }]
            });
            
            return true;
        } catch (error: any) {
            if (error.status === 401) {
                vscode.window.showErrorMessage('Invalid API key. Please check your key and try again.');
                return false;
            } else if (error.status === 429) {
                // Rate limited but key is valid
                return true;
            } else {
                vscode.window.showErrorMessage(`Failed to validate API key: ${error.message}`);
                return false;
            }
        }
    }

    async hasApiKey(): Promise<boolean> {
        const key = await this.getApiKey();
        return key !== undefined && key.length > 0;
    }

    async promptForApiKey(): Promise<string | undefined> {
        const key = await vscode.window.showInputBox({
            prompt: 'Enter your Anthropic API key',
            placeHolder: 'sk-ant-...',
            password: true,
            validateInput: (value) => {
                if (!value) {
                    return 'API key is required';
                }
                if (!value.startsWith('sk-ant-')) {
                    return 'Invalid API key format. Anthropic keys start with "sk-ant-"';
                }
                return null;
            }
        });

        if (key) {
            const isValid = await this.validateApiKey(key);
            if (isValid) {
                await this.setApiKey(key);
                vscode.window.showInformationMessage('API key saved successfully');
                return key;
            } else {
                return undefined;
            }
        }

        return undefined;
    }

    // Store additional API keys for other services
    async setServiceApiKey(service: string, key: string): Promise<void> {
        await this.context.secrets.store(`${ApiKeyManager.KEY_PREFIX}.${service}`, key);
    }

    async getServiceApiKey(service: string): Promise<string | undefined> {
        return await this.context.secrets.get(`${ApiKeyManager.KEY_PREFIX}.${service}`);
    }

    async deleteServiceApiKey(service: string): Promise<void> {
        await this.context.secrets.delete(`${ApiKeyManager.KEY_PREFIX}.${service}`);
    }

    // Get all stored services (for management UI)
    async getStoredServices(): Promise<string[]> {
        // VS Code doesn't provide a way to list all secrets, so we maintain a list
        const servicesList = this.context.globalState.get<string[]>('stored-services', []);
        return servicesList;
    }
}