/**
 * Release notes, from CHANGELOG.md (bundled with the app) or from the notes the updater
 * reads in latest.json. Both are the same CHANGELOG.md section, in a small part of Markdown:
 * "### " headings, "- " bullets, paragraphs, **bold**, `code` and [links](url), which show
 * as their text. Nothing is rendered as HTML.
 */

export interface NoteText {
  text: string;
  bold?: boolean;
  code?: boolean;
}

export type NoteBlock =
  | { kind: "heading"; text: NoteText[] }
  | { kind: "list"; items: NoteText[][] }
  | { kind: "paragraph"; text: NoteText[] };

/** The section under "## [version] - date" in CHANGELOG.md, without its heading. */
export function changelogSection(changelog: string, version: string): string | undefined {
  const lines = changelog.replace(/\r/g, "").split("\n");
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start < 0) return undefined;
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  const body = lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
  return body || undefined;
}

/** Whether notes list any changes, unlike the old "See https://…" updater notes. */
export function hasChanges(notes?: string): boolean {
  return !!notes && /^- /m.test(notes.replace(/\r/g, ""));
}

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\([^)]*\)/g;

function inline(text: string): NoteText[] {
  const parts: NoteText[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index! > last) parts.push({ text: text.slice(last, match.index) });
    if (match[1] != null) parts.push({ text: match[1], bold: true });
    else if (match[2] != null) parts.push({ text: match[2], code: true });
    else parts.push({ text: match[3] });
    last = match.index! + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

export function parseNotes(markdown: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] | undefined;
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: inline(paragraph.join(" ")) });
    if (list) blocks.push({ kind: "list", items: list.map(inline) });
    paragraph = [];
    list = undefined;
  };
  for (const raw of markdown.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
    } else if (/^#{1,6} /.test(line)) {
      flush();
      blocks.push({ kind: "heading", text: inline(line.replace(/^#+ /, "")) });
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      if (paragraph.length) flush();
      (list ??= []).push(line.slice(2));
    } else if (list) {
      // A wrapped bullet continues on the next line.
      list[list.length - 1] += " " + line;
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}
