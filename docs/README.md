# cc2cc Documentation

This directory contains the technical reference documentation for the cc2cc hub-and-spoke communication system.

## Documents

### [ARCHITECTURE.md](ARCHITECTURE.md)

**Audience:** Contributors, developers integrating with cc2cc, anyone debugging the system.

Comprehensive technical reference covering workspace layout, component responsibilities, message flow diagrams, WebSocket protocol, queue architecture, and the design invariants that must be preserved. Start here to understand how the system fits together.

### [REST_API.md](REST_API.md)

**Audience:** Developers calling the hub REST API directly, or building integrations.

Full REST endpoint reference with request/response shapes, authentication requirements, error codes, and worked examples. Covers all `/api/*` routes including topics management.

### [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

**Audience:** Anyone running cc2cc who hits a problem — setup failures, connectivity issues, unexpected behaviour.

Covers the most common failure modes: hub not starting, plugin not connecting, messages not delivered, dashboard blank, Redis errors, and Docker networking issues. Includes diagnostic commands.

### [DOCUMENTATION_STYLE_GUIDE.md](DOCUMENTATION_STYLE_GUIDE.md)

**Audience:** Contributors writing or updating documentation.

Standards for all project documentation: heading hierarchy, code block conventions, tone, Mermaid diagram colours, table formatting, and cross-linking rules. All docs in this directory follow this guide.

---

## Project-level documentation

These files live in the project root:

| File | Description |
|------|-------------|
| [`README.md`](../README.md) | Quick start, configuration reference, MCP tools, and dashboard overview |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | Development environment setup, test/lint workflow, commit conventions, PR process |
| [`CHANGELOG.md`](../CHANGELOG.md) | Version history in Keep a Changelog format |
| [`SECURITY.md`](../SECURITY.md) | Threat model, known limitations, deployment constraints, and responsible disclosure |
| [`ENHANCEMENTS.md`](../ENHANCEMENTS.md) | Ranked roadmap of planned features |
