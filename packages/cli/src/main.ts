import { writeFileSync } from "node:fs";
import { run } from "./cli";

const result = run(process.argv.slice(2));

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

process.exitCode = result.code;

// Keep the bundler from complaining about an unused import in some setups.
void writeFileSync;
