# Security Policy

## Supported versions

The `main` branch receives security fixes.

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Use GitHub's
private vulnerability reporting (Security → Report a vulnerability) or contact
the maintainer directly. We aim to respond within 72 hours.

## Threat model

This project is a read-only market data viewer with a small HTTP server. Things
we care about:

- **SSRF / provider abuse** — adapters fetch fixed third-party hosts; do not add
  user-controlled URLs. Report any endpoint that reflects input into a fetch URL.
- **Path traversal** — static file serving is scoped to `web/`; report anything
  that escapes it.
- **DoS via cache / concurrency** — requests are cached and pooled; report
  endpoints that can be forced into unbounded upstream fan-out.
- **Injected content** — data source responses are rendered in the UI; report
  any place where upstream text reaches the DOM without escaping.
- **Secrets** — there are no API keys in this project. If you find a hardcoded
  credential, report it immediately.

## Out of scope

- Financial losses caused by using the software (see the disclaimer in `LICENSE`).
- Availability of third-party free data endpoints.
- Self-hosted deployments exposed without HTTPS/reverse-proxy hardening.
