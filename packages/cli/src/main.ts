import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { run } from "./cli";

const result = run(process.argv.slice(2));

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.delegate) {
  const child = spawnSync(result.delegate.command, result.delegate.args, {
    cwd: result.delegate.cwd,
    env: result.delegate.env,
    stdio: "inherit",
  });
  if (child.error) {
    process.stderr.write(`${child.error.message}\n`);
    process.exitCode = 1;
  } else {
    process.exitCode = child.status ?? 1;
  }
} else {
  process.exitCode = result.code;
}

// Keep the bundler from complaining about an unused import in some setups.
void writeFileSync;
