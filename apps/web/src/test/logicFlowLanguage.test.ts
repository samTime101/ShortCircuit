import { describe, expect, it } from "vitest";
import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { getStyleTags, tags } from "@lezer/highlight";
import { logicflowLanguage } from "../editor/logicFlowLanguage";

interface Token {
  name: string;
  text: string;
}

/** Every leaf of the syntax tree, with the text it covers. */
function leaves(source: string): Token[] {
  const state = EditorState.create({ doc: source, extensions: [logicflowLanguage] });
  const found: Token[] = [];
  const cursor = syntaxTree(state).cursor();
  do {
    if (cursor.name) {
      found.push({ name: cursor.name, text: source.slice(cursor.from, cursor.to) });
    }
  } while (cursor.next());
  return found;
}

function comments(source: string): string[] {
  return leaves(source)
    .filter((token) => token.name === "comment")
    .map((token) => token.text);
}

describe("logic flow language", () => {
  it("marks a line comment as a comment", () => {
    expect(comments("INPUT a // a note")).toEqual(["// a note"]);
  });

  it("marks a block comment on one line as a comment", () => {
    expect(comments("INPUT a /* a note */")).toEqual(["/* a note */"]);
  });

  it("marks every line of a block comment as a comment", () => {
    const found = comments("/* one\n   two\n   three */\nINPUT a");
    expect(found).toHaveLength(3);
    expect(found[0]).toBe("/* one");
    expect(found[1]).toBe("   two");
    expect(found[2]).toBe("   three */");
  });

  it("keeps a comment that ends mid line from swallowing the code", () => {
    const found = leaves("/* note */ INPUT a");
    const input = found.find((token) => token.text.includes("INPUT"));
    expect(input?.name).not.toBe("comment");
  });

  it("keeps comment markers inside strings as strings", () => {
    const found = leaves('CASE "a // b"');
    expect(found.some((token) => token.name === "comment")).toBe(false);
    expect(found.some((token) => token.name === "string")).toBe(true);
  });

  it("no longer marks # as a comment", () => {
    const found = leaves("# not a comment");
    expect(found.some((token) => token.name === "comment")).toBe(false);
  });

  it("still finds keywords and built-ins after a comment", () => {
    const found = leaves("/* note */\nCIRCUIT Demo");
    expect(found.some((token) => token.name === "keyword")).toBe(true);
  });

  it("tags comments with the tag the style sheet uses", () => {
    const state = EditorState.create({
      doc: "// note\n/* block */",
      extensions: [logicflowLanguage],
    });
    const cursor = syntaxTree(state).cursor();
    const found: unknown[] = [];
    do {
      const style = getStyleTags(cursor);
      if (style) found.push(...style.tags);
    } while (cursor.next());
    // The highlight style keys on `tags.lineComment`, so the token has to
    // carry that exact tag or the comment renders unstyled.
    expect(found).toContain(tags.lineComment);
  });
});
