# Contributing to Subify

Thank you for your interest in contributing to Subify.

Subify is an open-source project focused on AI-powered subtitle translation, live captions, and dubbing. Contributions of all kinds are welcome, including bug reports, feature requests, documentation improvements, code changes, and testing.

## Before You Contribute

Please:

- Read the [Code of Conduct](.github/CODE_OF_CONDUCT.md).
- Search existing issues before opening a new one.
- For security vulnerabilities, do not open a public issue. Please follow the instructions in [SECURITY.md](SECURITY.md).
- Keep changes focused and avoid unrelated modifications.

## Reporting Bugs

Before opening a bug report:

1. Search existing issues to make sure the problem has not already been reported.
2. Make sure you are using a recent version of Subify.
3. Try to reproduce the issue with a clean configuration when possible.

A useful bug report should include:

- Subify version
- Browser and browser version
- Operating system
- Steps to reproduce the problem
- Expected behavior
- Actual behavior
- Relevant console errors or logs
- Screenshots or recordings when useful

## Requesting Features

Feature requests are welcome.

Please describe:

- The problem you are trying to solve
- The proposed feature
- Why the feature would be useful
- Any alternative solutions you have considered

Please search existing issues before opening a new feature request.

## Development Workflow

### 1. Fork the Repository

Fork the Subify repository to your GitHub account.

### 2. Clone Your Fork

```bash
git clone https://github.com/YOUR-USERNAME/Subify.git
cd Subify
```

### 3. Create a Branch

Create a separate branch for your change:

```bash
git checkout -b feature/your-feature
```

For bug fixes:

```bash
git checkout -b fix/your-fix
```

### 4. Make Your Changes

Keep your changes focused on the issue or feature you are working on.

Avoid:

- Unrelated refactoring
- Unnecessary formatting changes
- Removing existing functionality without discussion
- Committing generated files unless they are required
- Including API keys, passwords, tokens, or other secrets

### 5. Test Your Changes

Before submitting a pull request:

- Test the affected functionality.
- Test the extension in the relevant browser(s).
- Check the browser console for errors.
- Make sure existing functionality has not been unintentionally broken.

If your change affects Chrome and Firefox differently, test both when possible.

### 6. Commit Your Changes

Use a clear commit message that describes what you changed.

Examples:

```text
fix: resolve subtitle synchronization issue
```

```text
feat: add subtitle translation provider
```

```text
docs: improve installation instructions
```

### 7. Push Your Branch

```bash
git push origin your-branch-name
```

### 8. Open a Pull Request

Open a pull request against the `main` branch of Subify.

Your pull request should include:

- A clear title
- A description of the changes
- The reason for the change
- Testing performed
- Screenshots or recordings when relevant
- Any known limitations or remaining issues

## Pull Request Guidelines

Please keep pull requests:

- Focused
- Easy to review
- Well documented
- Tested
- Free from unrelated changes

Large changes or architectural changes should generally be discussed in an issue before implementation.

Maintainers may request changes before a pull request is merged.

## Code Style

Follow the existing coding style and project structure.

When adding new code:

- Prefer readable and maintainable solutions.
- Avoid unnecessary complexity.
- Reuse existing utilities and components when appropriate.
- Add comments only when they provide useful context.
- Keep user-facing text clear and consistent.

## Documentation

Documentation improvements are always welcome.

You can contribute by:

- Fixing typos
- Improving explanations
- Adding examples
- Updating installation instructions
- Documenting new features
- Improving troubleshooting information

## Security

Please do not publicly disclose security vulnerabilities through GitHub Issues, Pull Requests, or Discussions.

See [SECURITY.md](SECURITY.md) for the recommended reporting process.

## Code of Conduct

All contributors are expected to follow the [Contributor Covenant Code of Conduct](.github/CODE_OF_CONDUCT.md).

## License

Subify contains licensing information in the repository's license files.

By contributing to Subify, you agree that your contribution may be distributed according to the applicable licensing terms of the project.

See:

- [MIT License](LICENSE)
- [GNU Affero General Public License v3.0](LICENSE-AGPL)

## Questions

For general questions about contributing, please use the project's GitHub Issues or Discussions when appropriate.

For security-related concerns, follow the process described in [SECURITY.md](SECURITY.md).

Thank you for helping improve Subify.
