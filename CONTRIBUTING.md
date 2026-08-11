# Contributing to Isomite

Thanks for helping improve Isomite.

## Before opening an issue

- Search existing issues first.
- Use a copied test vault and a dedicated empty R2 bucket.
- Never post R2 credentials, encryption passphrases, recovery keys, or plugin `data.json`.
- Include the Obsidian version, Isomite version, operating system, and clear reproduction steps.

For suspected security vulnerabilities, do not publish sensitive details in a public issue. Use GitHub's private security advisory reporting for this repository.

## Development setup

Requirements:

- Node.js 22
- npm

```bash
git clone https://github.com/ratatulieoi/obsidian-isomite.git
cd obsidian-isomite
npm ci
npm test
npm run build
```

The production bundle is written to `main.js`.

## Pull requests

1. Create a focused branch from `main`.
2. Add or update tests for behavioral changes.
3. Run:

   ```bash
   npm test
   npm run build
   git diff --check
   ```

4. Explain the user-visible behavior, safety impact, and tests in the pull request.

Keep synchronization changes conservative: never resolve ambiguity by discarding content, never bypass conditional R2 writes, and preserve the review-before-apply model.

Do not manually edit generated release notes or changelogs.

## Style

- Use TypeScript with strict typing.
- Keep storage and sync classification logic testable without Obsidian.
- Prefer small, explicit changes over broad rewrites.
- Keep desktop and mobile compatibility.
- Avoid adding network services, analytics, or telemetry.

## Release process

Maintainers publish version tags matching `manifest.json`. GitHub Actions runs tests, reproduces `main.js`, creates build-provenance attestations for release assets, and publishes the GitHub release.
