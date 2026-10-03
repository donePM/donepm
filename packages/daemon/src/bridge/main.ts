#!/usr/bin/env node
import { runShim } from "./shim.js";

process.exitCode = await runShim({ env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr });
// An open stdin would keep the process alive after the daemon went away.
process.stdin.destroy();
