# Contributing to Raisedline

Thank you for helping. Raisedline is for blind and visually impaired students and the people
who make their materials, so feedback from tactile readers, braille transcribers and teachers
of the visually impaired is as valuable as code.

## Ways to help

- **Try it on real material** and tell us what reads well and what doesn't. Photos of swell
  paper prints with notes are very welcome.
- **Report a bug** or **suggest a feature** with the issue templates.
- **Improve braille output**: compare with liblouis or your own transcription and open an
  issue with the text, the expected braille and the code (e.g. UEB Grade 1).
- **Send a pull request** for code, documentation or examples.

## Development setup

You need Node.js 22.12 or newer. liblouis is optional but enables extra tests.

```bash
npm ci
```

```bash
npm run dev
```

Before opening a pull request, run the same checks as CI:

```bash
npm run check
```

```bash
npm run build && npm run test:e2e
```

## Guidelines

- Keep `@raisedline/core` free of DOM and Node-only APIs so it runs everywhere.
- Every exporter must work from the shared primitives so outputs stay consistent.
- New touch rules need a test with a graphic that triggers them and one that does not, a
  plain-language message and a concrete hint.
- Measurements are in millimetres, with the origin at the top-left of the page.
- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`,
  `chore:`) and add a line under **Unreleased** in `CHANGELOG.md` for user-visible changes.
- Be kind. See the [code of conduct](CODE_OF_CONDUCT.md).

## Releasing (maintainers)

```bash
npm run version:bump -- patch
```

```bash
git commit -am "chore(release): vX.Y.Z" && git tag -a vX.Y.Z -m "vX.Y.Z" && git push --follow-tags
```

The release workflow checks the tag against the version, builds, tests and publishes the
GitHub Release with all artifacts.
