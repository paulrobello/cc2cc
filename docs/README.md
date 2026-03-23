# cc2cc Documentation Index

This directory contains technical documentation for cc2cc (Claude-to-Claude Communication Hub).

## Table of Contents

- [Core Documentation](#core-documentation)
- [API Reference](#api-reference)
- [Guides](#guides)
- [Internal Planning](#internal-planning)
- [Related Documentation](#related-documentation)

---

## Core Documentation

| File | Description |
|------|-------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Full technical reference: workspace layout, component responsibilities, message flow, WebSocket protocol, REST API, queue design, and design invariants |
| [DOCUMENTATION_STYLE_GUIDE.md](DOCUMENTATION_STYLE_GUIDE.md) | Standards for writing and maintaining documentation in this project |

---

## API Reference

| File | Description |
|------|-------------|
| [api/REST_API.md](api/REST_API.md) | Complete REST endpoint reference with request/response shapes, authentication, and error codes |

---

## Guides

| File | Description |
|------|-------------|
| [guides/TROUBLESHOOTING.md](guides/TROUBLESHOOTING.md) | Common failure modes, diagnostic steps, and solutions |

---

## Internal Planning

The `superpowers/` directory contains internal planning documents (specs, plans) generated during development. These are **not** end-user or contributor documentation — they document design decisions and implementation planning for the cc2cc maintainers.

| Path | Description |
|------|-------------|
| `superpowers/plans/` | Implementation plans created during development phases |
| `superpowers/specs/` | Feature specifications and technical designs |

---

## Related Documentation

Project-level documentation lives at the repository root:

| File | Description |
|------|-------------|
| [../README.md](../README.md) | Project overview, quick start, configuration, and MCP tools reference |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Development setup, testing, branch conventions, and PR process |
| [../SECURITY.md](../SECURITY.md) | Threat model, known limitations, and responsible disclosure |
| [../CHANGELOG.md](../CHANGELOG.md) | Version history |
| [../skill/skills/cc2cc/SKILL.md](../skill/skills/cc2cc/SKILL.md) | Claude Code collaboration protocol and MCP tool reference |
