import { changelogSection, hasChanges, parseNotes } from "./release-notes";

const CHANGELOG = `# Changelog

## [Unreleased]

- Not out yet.

## [1.5.0] - 2026-11-10

### Added

- **Favorites** in the sidebar.
- Search by \`PT\`, see [the docs](https://example.invalid/docs).

## [1.4.0] - 2026-10-01

- Older.
`;

describe("release notes", () => {
  it("finds a version's section in the changelog", () => {
    expect(changelogSection(CHANGELOG, "1.5.0")).toBe(
      "### Added\n\n- **Favorites** in the sidebar.\n- Search by `PT`, see [the docs](https://example.invalid/docs).",
    );
    expect(changelogSection(CHANGELOG, "1.4.0")).toBe("- Older.");
  });

  it("has no section for a missing version or a longer one", () => {
    expect(changelogSection(CHANGELOG, "9.9.9")).toBeUndefined();
    expect(changelogSection(CHANGELOG, "1.5")).toBeUndefined();
  });

  it("reads Windows line endings", () => {
    expect(changelogSection(CHANGELOG.replace(/\n/g, "\r\n"), "1.4.0")).toBe("- Older.");
  });

  it("parses headings, bullets and inline styles without HTML", () => {
    const blocks = parseNotes(changelogSection(CHANGELOG, "1.5.0")!);
    expect(blocks).toEqual([
      { kind: "heading", text: [{ text: "Added" }] },
      {
        kind: "list",
        items: [
          [{ text: "Favorites", bold: true }, { text: " in the sidebar." }],
          [{ text: "Search by " }, { text: "PT", code: true }, { text: ", see " }, { text: "the docs" }, { text: "." }],
        ],
      },
    ]);
  });

  it("joins wrapped bullets and keeps markup as text", () => {
    const blocks = parseNotes("- One <b>line</b>\n  continued\n\nA paragraph.");
    expect(blocks).toEqual([
      { kind: "list", items: [[{ text: "One <b>line</b> continued" }]] },
      { kind: "paragraph", text: [{ text: "A paragraph." }] },
    ]);
  });

  it("tells changelog notes from the old link-only notes", () => {
    expect(hasChanges("### Added\n\n- Something")).toBeTrue();
    expect(hasChanges("See https://github.com/LuisBadal0/LubaTV/releases/tag/v1.4.3")).toBeFalse();
    expect(hasChanges(undefined)).toBeFalse();
  });
});
