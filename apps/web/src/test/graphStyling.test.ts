import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * An SVG element without a fill rule is drawn black, which reads as a blob on
 * the canvas. This test keeps every shape in the graph styled, either with its
 * own class or through an ancestor rule.
 */

function findFile(...candidates: string[]): string {
  let directory = process.cwd();
  for (let step = 0; step < 6; step += 1) {
    for (const candidate of candidates) {
      const path = join(directory, candidate);
      if (existsSync(path)) return path;
    }
    directory = dirname(directory);
  }
  throw new Error(`Could not find any of ${candidates.join(", ")}`);
}

const CLASS_PATTERN = /className=(?:"([^"]+)"|\{`([^`]+)`\})/g;

describe("graph styling", () => {
  const css = readFileSync(findFile("apps/web/src/styles.css", "src/styles.css"), "utf8");
  const graph = readFileSync(
    findFile("apps/web/src/components/CircuitGraph.tsx", "src/components/CircuitGraph.tsx"),
    "utf8",
  );

  it("gives every drawn shape a fill", () => {
    const shapes = [...graph.matchAll(/<(rect|text|circle|path)\b([^>]*)>/g)];
    expect(shapes.length).toBeGreaterThan(5);

    for (const shape of shapes) {
      const tag = shape[1]!;
      const attributes = shape[2] ?? "";
      const own = /className="([^"]+)"/.exec(attributes)?.[1];

      if (own) {
        for (const name of own.split(/\s+/).filter(Boolean)) {
          expect(css, `${name} has no style`).toContain(`.${name}`);
        }
        continue;
      }

      const before = graph.slice(Math.max(0, shape.index! - 400), shape.index!);
      const ancestors = [...before.matchAll(CLASS_PATTERN)];
      const ancestor = ancestors.pop();
      const ancestorClass = (ancestor?.[1] ?? ancestor?.[2] ?? "").split(/\s+/)[0];
      expect(ancestorClass, `a ${tag} without a class`).toBeTruthy();
      expect(css, `.${ancestorClass} ${tag} is not styled`).toContain(`.${ancestorClass} ${tag}`);
    }
  });
});
