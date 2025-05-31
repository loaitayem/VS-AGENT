# Contributing to AI Code Agent

Thank you for your interest in contributing to AI Code Agent! This guide will help you get started.

## Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct:
- Be respectful and inclusive
- Welcome newcomers and help them get started
- Focus on constructive criticism
- Respect differing viewpoints and experiences

## How to Contribute

### Reporting Issues

1. **Check existing issues** first to avoid duplicates
2. **Use issue templates** when available
3. **Provide details**:
   - VS Code version
   - Extension version
   - Steps to reproduce
   - Expected vs actual behavior
   - Error messages/logs

### Suggesting Features

1. **Open a discussion** first for major features
2. **Explain the use case** and benefits
3. **Consider implementation** complexity
4. **Be open to feedback** and alternatives

### Contributing Code

#### Setup Development Environment

1. **Fork and clone** the repository
   ```bash
   git clone https://github.com/YOUR_USERNAME/ai-code-agent.git
   cd ai-code-agent
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up Ollama** (for preprocessor)
   ```bash
   curl -fsSL https://ollama.ai/install.sh | sh
   ollama pull llama3
   ```

4. **Create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

#### Development Workflow

1. **Write code** following our style guide
2. **Add tests** for new functionality
3. **Run checks** before committing:
   ```bash
   npm run lint
   npm test
   npm run compile
   ```

4. **Commit** with meaningful messages:
   ```bash
   git commit -m "feat: add new preprocessor model support"
   ```

   Follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` New features
   - `fix:` Bug fixes
   - `docs:` Documentation changes
   - `style:` Code style changes
   - `refactor:` Code refactoring
   - `test:` Test additions/changes
   - `chore:` Maintenance tasks

5. **Push** and create a pull request

#### Pull Request Guidelines

1. **Title** should follow conventional commits
2. **Description** should include:
   - What changes were made
   - Why they were made
   - How to test them
   - Screenshots (if UI changes)

3. **Requirements**:
   - All tests pass
   - No linting errors
   - Documentation updated
   - No decrease in test coverage

## Development Guidelines

### Code Style

- Use TypeScript strict mode
- Follow ESLint configuration
- Use meaningful variable names
- Add JSDoc comments for public APIs
- Keep functions small and focused

### Testing

- Write unit tests for new features
- Test edge cases and error conditions
- Mock external dependencies
- Aim for >80% code coverage

### Performance

- Profile performance for heavy operations
- Use lazy loading where appropriate
- Implement cancellation tokens
- Cache expensive computations
- Handle large files gracefully

### Security

- Never log sensitive information
- Validate all user inputs
- Use VS Code's secret storage for keys
- Sanitize file paths
- Follow principle of least privilege

## Project Structure

```
src/
├── agent/          # Core agent logic
├── api/            # API integrations
├── assistant/      # Prompt assistance
├── config/         # Configuration management
├── indexer/        # Codebase indexing
├── models/         # Model management
├── preprocessor/   # Free model integration
└── ui/             # User interface components
```

## Testing

### Run Tests
```bash
# All tests
npm test

# Specific test file
npm test -- --grep "AgentCore"

# With coverage
npm run test:coverage

# In watch mode
npm run test:watch
```

### Write Tests
```typescript
describe('Feature', () => {
    it('should do something', async () => {
        // Arrange
        const input = 'test';
        
        // Act
        const result = await feature(input);
        
        // Assert
        assert.strictEqual(result, expected);
    });
});
```

## Documentation

### Code Documentation
- Add JSDoc comments for public methods
- Include parameter descriptions
- Add usage examples
- Document return values and exceptions

### User Documentation
- Update README.md for new features
- Add examples to QUICKSTART.md
- Update configuration docs
- Include screenshots for UI changes

## Release Process

1. **Version bump** following semver
2. **Update CHANGELOG.md**
3. **Run final checks**
4. **Create release PR**
5. **Tag and publish** after merge

## Getting Help

- **Discord**: Join our community server
- **Discussions**: Use GitHub Discussions
- **Office Hours**: Weekly contributor calls
- **Mentorship**: Tag @maintainers for guidance

## Recognition

Contributors are recognized in:
- README.md contributors section
- Release notes
- Annual contributor spotlight

## License

By contributing, you agree that your contributions will be licensed under the MIT License.