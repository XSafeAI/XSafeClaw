# Contributing to XSafeClaw

Thank you for your interest in contributing! This guide will help you get started.

## Getting Started

1. Fork the repository and clone your fork
2. Set up the development environment (see [Development Setup](#development-setup))
3. Create a new branch for your changes: `git checkout -b feat/your-feature`
4. Make your changes, add tests, and ensure everything passes
5. Submit a pull request to the `main` branch

## Development Setup

**Prerequisites:** Python 3.11+, Node.js 18+, [uv](https://docs.astral.sh/uv/)

```bash
# Install uv (if not already installed)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Clone and install
git clone https://github.com/XSafeAI/XSafeClaw.git && cd XSafeClaw
uv venv && uv pip install -e ".[dev]"

# Start backend
python run.py   # http://localhost:6874

# Start frontend (separate terminal)
cd frontend && npm install && npm run dev   # http://localhost:3000
```

## Running Tests

```bash
# Backend tests
pytest tests/

# Lint
ruff check src/
```

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Write clear commit messages following [Conventional Commits](https://www.conventionalcommits.org/):
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`
- Add or update tests for any changed behavior
- Update documentation if your change affects usage

## Reporting Issues

Please use [GitHub Issues](https://github.com/XSafeAI/XSafeClaw/issues) to report bugs or request features. Include:
- A clear description of the problem or request
- Steps to reproduce (for bugs)
- Your environment: OS, Python version, XSafeClaw version

## Code Style

- Python: [PEP 8](https://peps.python.org/pep-0008/), formatted with `ruff`
- TypeScript/React: follow existing patterns in `frontend/src/`

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
