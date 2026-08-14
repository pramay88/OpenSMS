# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly.

**Do not** open a public GitHub issue for security vulnerabilities.

Instead, email the maintainers with:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and aim to provide an initial assessment within 7 days.

## Security Model Summary

- External applications authenticate with per-client API keys
- Android gateways authenticate with per-device credentials (never a shared master secret)
- Registration tokens are single-use and short-lived
- The Android app initiates outbound HTTPS connections only
- Message bodies and credentials must not appear in logs

See [docs/SECURITY.md](docs/SECURITY.md) for the full security model.

## Scope

In scope:

- Gateway Server API
- Android Gateway application
- Authentication and authorization flows
- Credential storage and transmission

Out of scope:

- Carrier network security
- External application implementations
- Physical device compromise
