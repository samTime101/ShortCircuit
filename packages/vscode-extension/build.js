const esbuild = require("esbuild");
const path = require("path");

async function main() {
  const isWatch = process.argv.includes("--watch");

  const commonOptions = {
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    sourcemap: true,
    external: ["vscode"],
    logLevel: "info",
    loader: {
      ".json": "json"
    }
  };

  const extCtx = await esbuild.context({
    ...commonOptions,
    entryPoints: [path.join(__dirname, "src", "extension.ts")],
    outfile: path.join(__dirname, "out", "extension.js")
  });

  const lsCtx = await esbuild.context({
    ...commonOptions,
    entryPoints: [path.join(__dirname, "src", "language-server.ts")],
    outfile: path.join(__dirname, "out", "language-server.js")
  });

  if (isWatch) {
    await Promise.all([extCtx.watch(), lsCtx.watch()]);
    console.log("Watching for changes...");
  } else {
    await Promise.all([extCtx.rebuild(), lsCtx.rebuild()]);
    await Promise.all([extCtx.dispose(), lsCtx.dispose()]);
    console.log("Extension and Language Server built successfully.");
  }
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
