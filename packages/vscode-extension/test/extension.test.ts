import { compileCore as compile } from "@shortcircuit/engine/core";
import { compile as compileWithPackages, Simulator, generateTruthTable, formatSource, parsePackageMacroSource } from "@shortcircuit/engine";
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { buildLayout } from "../src/graphLayout";
import { getStudioHtml, type StudioModel } from "../src/studioHtml";
import { resolveWorkspaceContext } from "../src/packageResolver";

/** Converts Oniguruma regex pattern with (?i) to JS RegExp with 'i' flag for testing */
function toJsRegex(pattern: string): RegExp {
  if (pattern.startsWith("(?i)")) {
    return new RegExp(pattern.slice(4), "i");
  }
  return new RegExp(pattern);
}

describe("Short Circuit Engine Integration", () => {
  it("compiles a simple circuit", () => {
    const source = `CIRCUIT Test
  INPUT a
  OUTPUT a
END`;
    const result = compile(source, { disableDefaultPackages: true });
    expect(result.circuits).toHaveLength(1);
  });

  it("compiles with lowercase keywords", () => {
    const source = `circuit nice
  input a
  input b
  out = nand(a, b)
  output out
end`;
    const result = compileWithPackages(source);
    expect(result.circuits).toHaveLength(1);
    expect(result.circuits[0].name).toBe("nice");
  });

  it("detects syntax errors", () => {
    const badSource = `CIRCUIT Bad
  INPUT a
  OUTPUT
END`;
    const result = compile(badSource, { disableDefaultPackages: true });
    expect(result.diagnostics.some(d => d.severity === "error")).toBe(true);
  });

  it("detects undefined identifiers", () => {
    const badSource = `CIRCUIT Bad
  INPUT a
  y = UNDEFINED(a)
  OUTPUT y
END`;
    const result = compile(badSource, { disableDefaultPackages: true });
    expect(result.diagnostics.some(d => d.severity === "error")).toBe(true);
  });
});

describe("Syntax Highlighting Grammar", () => {
  const grammarPath = path.join(__dirname, "..", "syntaxes", "logicflow.tmLanguage.json");
  const grammarJson = JSON.parse(fs.readFileSync(grammarPath, "utf-8"));

  it("has valid schema, scopeName, and fileTypes", () => {
    expect(grammarJson.name).toBe("LogicFlow");
    expect(grammarJson.scopeName).toBe("source.logicflow");
    expect(grammarJson.fileTypes).toContain("lf");
  });

  it("matches lowercase and uppercase keywords in grammar", () => {
    const keywordPattern = grammarJson.repository.keywords.patterns[0].match;
    const regex = toJsRegex(keywordPattern);

    // Test case insensitivity
    expect(regex.test("circuit")).toBe(true);
    expect(regex.test("CIRCUIT")).toBe(true);
    expect(regex.test("Circuit")).toBe(true);
    expect(regex.test("input")).toBe(true);
    expect(regex.test("output")).toBe(true);
    expect(regex.test("end")).toBe(true);
    expect(regex.test("test")).toBe(true);
    expect(regex.test("case")).toBe(true);
    expect(regex.test("expect")).toBe(true);

    const importPattern = grammarJson.repository.keywords.patterns[1].match;
    const importRegex = toJsRegex(importPattern);
    expect(importRegex.test("import")).toBe(true);
    expect(importRegex.test("IMPORT")).toBe(true);
    expect(importRegex.test("Import")).toBe(true);
  });

  it("matches built-in gates case-insensitively", () => {
    const builtinPattern = grammarJson.repository.builtins.patterns[0].match;
    const regex = toJsRegex(builtinPattern);

    expect(regex.test("NAND")).toBe(true);
    expect(regex.test("nand")).toBe(true);
    expect(regex.test("Nand")).toBe(true);
    expect(regex.test("AND")).toBe(true);
    expect(regex.test("and")).toBe(true);
    expect(regex.test("OR")).toBe(true);
    expect(regex.test("NOT")).toBe(true);
    expect(regex.test("XOR")).toBe(true);
    expect(regex.test("MUX")).toBe(true);
  });

  it("matches comments correctly (double slash and block)", () => {
    const lineCommentPattern = grammarJson.repository.comments.patterns[0].match;
    const regex = toJsRegex(lineCommentPattern);

    expect(regex.test("// this is a comment")).toBe(true);
    expect(regex.test("//comment")).toBe(true);
  });

  it("matches member and port access expressions like apple.y", () => {
    const memberPattern = grammarJson.repository.members.patterns[0].match;
    const regex = toJsRegex(memberPattern);

    expect(regex.test("apple.y")).toBe(true);
    expect(regex.test("result.y")).toBe(true);
    expect(regex.test("adder.sum")).toBe(true);
  });

  it("matches number literals (binary, hex, decimal)", () => {
    const hexPattern = toJsRegex(grammarJson.repository.numbers.patterns[0].match);
    const binPattern = toJsRegex(grammarJson.repository.numbers.patterns[1].match);
    const decPattern = toJsRegex(grammarJson.repository.numbers.patterns[2].match);

    expect(hexPattern.test("0xFF")).toBe(true);
    expect(hexPattern.test("0x0")).toBe(true);
    expect(binPattern.test("0b1010")).toBe(true);
    expect(binPattern.test("0b0")).toBe(true);
    expect(decPattern.test("42")).toBe(true);
  });
});

describe("Language Configuration", () => {
  const langConfigPath = path.join(__dirname, "..", "language-configuration.json");
  const langConfig = JSON.parse(fs.readFileSync(langConfigPath, "utf-8"));

  it("configures double slash for line comments", () => {
    expect(langConfig.comments.lineComment).toBe("//");
    expect(langConfig.comments.blockComment).toEqual(["/*", "*/"]);
  });

  it("has auto-closing brackets and quotes", () => {
    expect(langConfig.brackets).toBeDefined();
    expect(langConfig.autoClosingPairs.some((p: { open: string }) => p.open === "(")).toBe(true);
    expect(langConfig.autoClosingPairs.some((p: { open: string }) => p.open === "\"")).toBe(true);
  });
});

describe("Graph Layout Engine", () => {
  it("builds layout for a combinational circuit", () => {
    const source = `circuit HalfAdder
  input a
  input b
  s = xor(a, b)
  c = and(a, b)
  output s
  output c
end`;
    const result = compileWithPackages(source);
    expect(result.circuits.length).toBeGreaterThan(0);
    const layout = buildLayout(result.circuits[0]);

    expect(layout.nodes.length).toBeGreaterThan(0);
    expect(layout.edges.length).toBeGreaterThan(0);
    expect(layout.width).toBeGreaterThan(200);
    expect(layout.height).toBeGreaterThan(100);
    expect(layout.depth).toBeGreaterThan(0);

    // Output nodes exist
    const outS = layout.nodes.find(n => n.label === "s" && n.kind === "output");
    const outC = layout.nodes.find(n => n.label === "c" && n.kind === "output");
    expect(outS).toBeDefined();
    expect(outC).toBeDefined();

    // Edges have curved paths
    for (const edge of layout.edges) {
      expect(edge.path).toContain("M ");
      expect(edge.path).toContain("C ");
    }
  });
});

describe("Studio HTML Generation", () => {
  it("renders studio HTML with model data", () => {
    const source = `circuit Simple
  input a
  input b
  y = nand(a, b)
  output y
end`;
    const res = compileWithPackages(source);
    const circuit = res.circuits[0];
    const sim = new Simulator(circuit);
    const snap = sim.setInputs({ a: 1, b: 0 });
    const layout = buildLayout(circuit);
    const tt = generateTruthTable(circuit);

    const model: StudioModel = {
      circuits: [{
        name: circuit.name,
        stats: circuit.stats,
        sequential: circuit.sequential,
        inputs: circuit.inputs.map(i => ({ name: i.name, width: i.width })),
        outputs: circuit.outputs.map(o => ({ name: o.name, width: o.width })),
      }],
      activeCircuit: circuit.name,
      inputs: { a: "1", b: "0" },
      snapshot: {
        inputs: snap.inputs,
        outputs: snap.outputs,
        nodes: snap.nodes,
      },
      layout,
      truthTable: {
        circuit: tt.circuit,
        inputs: tt.inputs,
        outputs: tt.outputs,
        rows: tt.rows,
      },
      waveform: {
        timeSteps: [],
        inputNames: ["a", "b"],
        outputNames: ["y"]
      },
      tests: null,
      ir: circuit,
      diagnostics: []
    };

    const html = getStudioHtml(model);
    expect(html).toContain("Short Circuit Studio");
    expect(html).toContain("circuit-picker");
    expect(html).toContain("btn-reset");
    expect(html).toContain("btn-expand");
    expect(html).toContain("tab-circuit");
    expect(html).toContain("tab-truth");
    expect(html).toContain("tab-waveform");
    expect(html).toContain("tab-tests");
    expect(html).toContain("tab-ir");
    expect(html).toContain("bus-text-input");
    expect(html).toContain("output-pill");
    expect(html).toContain("bit-cells");
    expect(html).toContain("renderSevenSegment");
  });

  it("handles empty or null model gracefully", () => {
    const html = getStudioHtml(null);
    expect(html).toContain("Short Circuit Studio");
    expect(html).toContain("No LogicFlow file active");
  });
});

describe("Extension Package Manifest", () => {
  const pkgPath = path.join(__dirname, "..", "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

  it("contributes activity bar container and view", () => {
    expect(pkg.contributes.viewsContainers.activitybar).toBeDefined();
    const ac = pkg.contributes.viewsContainers.activitybar[0];
    expect(ac.id).toBe("shortcircuit-sidebar");
    expect(ac.icon).toBe("media/shortcircuit.svg");

    expect(pkg.contributes.views["shortcircuit-sidebar"]).toBeDefined();
    const view = pkg.contributes.views["shortcircuit-sidebar"][0];
    expect(view.id).toBe("shortcircuit.studioView");
    expect(view.type).toBe("webview");
  });

  it("contributes all necessary commands", () => {
    const commands = pkg.contributes.commands.map((c: { command: string }) => c.command);
    expect(commands).toContain("shortcircuit.openStudio");
    expect(commands).toContain("shortcircuit.expandStudio");
    expect(commands).toContain("shortcircuit.openWaveform");
    expect(commands).toContain("shortcircuit.openTruthTable");
    expect(commands).toContain("shortcircuit.runTest");
    expect(commands).toContain("shortcircuit.runAllTests");
    expect(commands).toContain("shortcircuit.formatDocument");
  });

  it("includes proper activation events", () => {
    expect(pkg.activationEvents).toContain("onLanguage:logicflow");
    expect(pkg.activationEvents).toContain("onView:shortcircuit.studioView");
    expect(pkg.activationEvents).toContain("onCommand:shortcircuit.openStudio");
    expect(pkg.activationEvents).toContain("onCommand:shortcircuit.openTruthTable");
    expect(pkg.activationEvents).toContain("onCommand:shortcircuit.openWaveform");
    expect(pkg.activationEvents).toContain("onCommand:shortcircuit.formatDocument");
  });

  it("contributes language icon and file icon theme for .lf files", () => {
    const lang = pkg.contributes.languages[0];
    expect(lang.id).toBe("logicflow");
    expect(lang.icon).toBeDefined();
    expect(lang.icon.dark).toBe("./media/shortcircuit.svg");
    expect(lang.icon.light).toBe("./media/shortcircuit.svg");

    expect(pkg.contributes.iconThemes).toBeDefined();
    expect(pkg.contributes.iconThemes[0].id).toBe("shortcircuit-icons");
    const iconThemePath = path.join(__dirname, "..", pkg.contributes.iconThemes[0].path);
    expect(fs.existsSync(iconThemePath)).toBe(true);
    const themeJson = JSON.parse(fs.readFileSync(iconThemePath, "utf-8"));
    expect(themeJson.fileExtensions.lf).toBe("logicflow");
  });
});

describe("LogicFlow Formatter (Auto-capitalization and Indentation)", () => {
  it("auto-capitalizes keywords and built-in functions while indenting cleanly", () => {
    const messySource = `circuit my_adder
input a : bus(4)
input b : bus(4)
sum = and(a, b)
output sum
end`;
    const formatted = formatSource(messySource);
    expect(formatted).toContain("CIRCUIT my_adder");
    expect(formatted).toContain("  INPUT a : BUS(4)");
    expect(formatted).toContain("  INPUT b : BUS(4)");
    expect(formatted).toContain("  sum = AND(a, b)");
    expect(formatted).toContain("  OUTPUT sum");
    expect(formatted.trimEnd().endsWith("END")).toBe(true);
  });

  it("auto-capitalizes import statements and aliases", () => {
    const messy = `import "@shortcircuit/gates" as gates`;
    const formatted = formatSource(messy);
    expect(formatted).toContain(`IMPORT "@shortcircuit/gates" AS gates`);
  });

  it("preserves comments and string literal casing", () => {
    const code = `circuit Test
// this is a note about and(a, b)
out = "keep lower and(a, b)"
end`;
    const formatted = formatSource(code);
    expect(formatted).toContain("// this is a note about and(a, b)");
    expect(formatted).toContain(`"keep lower and(a, b)"`);
  });
});

describe("Bundle Integrity", () => {
  it("has built extension.js and language-server.js as CommonJS modules", async () => {
    const extFile = path.join(__dirname, "..", "out", "extension.js");
    const lsFile = path.join(__dirname, "..", "out", "language-server.js");

    if (!fs.existsSync(extFile) || !fs.existsSync(lsFile)) {
      const { execSync } = await import("child_process");
      execSync("node build.js", { cwd: path.join(__dirname, ".."), stdio: "pipe" });
    }

    expect(fs.existsSync(extFile)).toBe(true);
    expect(fs.existsSync(lsFile)).toBe(true);

    const extContent = fs.readFileSync(extFile, "utf-8");
    // Should be CommonJS (not raw ESM import * as vscode)
    expect(extContent).toContain("module.exports");
    expect(extContent).not.toMatch(/^import\s+\*\s+as\s+vscode/m);
  });
});

describe("Package Resolution (Intra-Package & Local Packages)", () => {
  it("resolves intra-package sibling exports without self-imports (add4 in arithmetic)", () => {
    const add4Path = path.resolve(
      __dirname,
      "../../../vendor/ShortCircuit-Packages/packages/arithmetic/circuits/add4/circuit.lf"
    );
    expect(fs.existsSync(add4Path)).toBe(true);

    const source = fs.readFileSync(add4Path, "utf-8");
    const context = resolveWorkspaceContext(add4Path, source);

    expect(context.packageRoot).toBeDefined();
    expect(context.enclosingPackageName).toBe("@shortcircuit/arithmetic");
    expect(context.implicitImports).toContain("@shortcircuit/arithmetic");
    expect(context.implicitImports).toContain("@shortcircuit/gates");

    // Compiling with resolved context should produce 0 errors
    const result = compileWithPackages(source, {
      packages: context.bundle,
      implicitImports: context.implicitImports,
    });

    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(0);
    expect(result.circuits.some((c) => c.name === "ADD4")).toBe(true);
  });

  it("resolves local packages in packages/ directory from project root", () => {
    // Create temporary workspace structure
    const tempDir = path.join(__dirname, "temp-test-project");
    const localPkgDir = path.join(tempDir, "packages", "custom-adder");
    const localCircuitsDir = path.join(localPkgDir, "circuits", "adder");
    const srcDir = path.join(tempDir, "src");

    try {
      fs.mkdirSync(localCircuitsDir, { recursive: true });
      fs.mkdirSync(srcDir, { recursive: true });

      // Package manifest
      fs.writeFileSync(
        path.join(localPkgDir, "manifest.json"),
        JSON.stringify(
          {
            schema: "shortcircuit.package/v1",
            name: "@local/custom-adder",
            version: "0.1.0",
            exports: [
              {
                kind: "circuit",
                name: "MY_ADDER",
                source: "circuits/adder/circuit.lf",
              },
            ],
          },
          null,
          2
        )
      );

      // Package circuit source
      fs.writeFileSync(
        path.join(localCircuitsDir, "circuit.lf"),
        `CIRCUIT MY_ADDER\n  INPUT a\n  INPUT b\n  out = NAND(a, b)\n  OUTPUT out\nEND`
      );

      // Project manifest
      fs.writeFileSync(
        path.join(tempDir, "shortcircuit.json"),
        JSON.stringify(
          {
            schema: "shortcircuit.project/v1",
            dependencies: {
              "@local/custom-adder": "path:packages/custom-adder",
            },
          },
          null,
          2
        )
      );

      // Project source file importing the local package
      const mainPath = path.join(srcDir, "main.lf");
      const mainSource = `IMPORT "@local/custom-adder"\nCIRCUIT Top\n  INPUT x\n  INPUT y\n  res = MY_ADDER(x, y)\n  OUTPUT res.out\nEND`;
      fs.writeFileSync(mainPath, mainSource);

      const context = resolveWorkspaceContext(mainPath, mainSource);
      expect(context.projectRoot).toBe(tempDir);
      expect(context.bundle.packages.some((p) => p.name === "@local/custom-adder")).toBe(true);

      const result = compileWithPackages(mainSource, {
        packages: context.bundle,
        implicitImports: context.implicitImports,
      });

      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(0);
      expect(result.circuits.some((c) => c.name === "Top")).toBe(true);
    } finally {
      // Clean up
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it("does not ship or resolve default packages in a clean project", () => {
    const tempDir = path.join(__dirname, "temp-clean-project");
    try {
      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, "shortcircuit.json"),
        JSON.stringify({ schema: "shortcircuit.project/v1", dependencies: {} }, null, 2)
      );
      const mainPath = path.join(tempDir, "main.lf");
      const mainSource = "CIRCUIT Top\n  INPUT x\n  OUTPUT x\nEND";
      fs.writeFileSync(mainPath, mainSource);

      const context = resolveWorkspaceContext(mainPath, mainSource);
      expect(context.bundle.packages).toHaveLength(0);
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it("validates package macro files without false E100 errors", () => {
    const macroSource = "MACRO BUFFER(x)\n  BODY NOT(NOT(x))\nEND\n";
    const { declarations, diagnostics } = parsePackageMacroSource(macroSource, "macro.lf");
    expect(diagnostics).toHaveLength(0);
    expect(declarations).toHaveLength(1);
    expect(declarations[0]!.name).toBe("BUFFER");
  });
});
