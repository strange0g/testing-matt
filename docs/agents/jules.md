# Google Jules Implementation Agent

All code authoring and implementation tasks in this repository are delegated to Google Jules (`jules.google`).

## Division of Labor

- **Local Harness:** Plans, conducts domain modeling, breaks down specs into tracer-bullet tickets, and runs read-only test verification. Does not edit code files directly in the repo.
- **Jules Coder Agent:** Receives ticket specifications, writes code test-first (red-green TDD), runs tests in its Cloud VM, and opens a GitHub Pull Request.
- **Jules Tester Agent:** Mandatory for every PR; authors adversarial and boundary tests in its Cloud VM to verify behavior.

## Environment Requirements

- `JULES_API_KEY`: Required environment variable or entry in `.env`.
- Jules GitHub App: Must be installed and authorized for this repository.
- Test runner: Test command configured in `package.json` (`npm test`) so Jules runs tests before opening PRs.
