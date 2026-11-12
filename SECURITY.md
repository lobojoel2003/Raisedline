# Security policy

## Supported versions

Security fixes are made for the latest release.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's
[private vulnerability reporting](https://github.com/lobojoel2003/Raisedline/security/advisories/new)
with a description, steps to reproduce and the version (`raisedline --version`). You should
get a reply within a week.

## Notes

- The web app runs entirely in the browser; files you open are not uploaded anywhere.
- `raisedline serve` listens on `127.0.0.1` by default. Only use `--host 0.0.0.0` on a network
  you trust: it exposes the app and the local braille translation endpoint.
- SVG files are parsed, not rendered: scripts and event handlers in imported SVGs are never run.
