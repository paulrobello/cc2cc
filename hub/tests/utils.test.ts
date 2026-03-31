import { describe, expect, it } from "bun:test";
import { parseProject, sanitizeProjectTopic } from "../src/utils.js";

describe("parseProject", () => {
  it("extracts project from standard instanceId", () => {
    expect(parseProject("user@host:myproject/uuid")).toBe("myproject");
  });

  it("returns empty string when no colon present", () => {
    expect(parseProject("nocolon")).toBe("");
  });
});

describe("sanitizeProjectTopic", () => {
  it("passes through valid names unchanged", () => {
    expect(sanitizeProjectTopic("cc2cc")).toBe("cc2cc");
    expect(sanitizeProjectTopic("my-project")).toBe("my-project");
    expect(sanitizeProjectTopic("project_1")).toBe("project_1");
  });

  it("strips leading dots", () => {
    expect(sanitizeProjectTopic(".claude")).toBe("claude");
    expect(sanitizeProjectTopic("..hidden")).toBe("hidden");
  });

  it("replaces invalid characters with hyphens", () => {
    expect(sanitizeProjectTopic("my.project")).toBe("my-project");
    expect(sanitizeProjectTopic("My Project!")).toBe("my-project");
  });

  it("collapses consecutive hyphens", () => {
    expect(sanitizeProjectTopic("a..b..c")).toBe("a-b-c");
  });

  it("strips trailing hyphens", () => {
    expect(sanitizeProjectTopic("test.")).toBe("test");
  });

  it("falls back to 'default' for empty result", () => {
    expect(sanitizeProjectTopic("...")).toBe("default");
    expect(sanitizeProjectTopic("")).toBe("default");
  });

  it("truncates to 64 chars", () => {
    const long = "a".repeat(100);
    expect(sanitizeProjectTopic(long).length).toBe(64);
  });
});
