import { run } from "./cli";

const result = await run(process.argv.slice(2));

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.code;
