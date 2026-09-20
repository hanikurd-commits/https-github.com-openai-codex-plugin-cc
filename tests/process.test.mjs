import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

import { terminateProcessTree } from "../plugins/codex/scripts/lib/process.mjs";

async function waitForExit(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") {
        return true;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

test("terminateProcessTree uses taskkill on Windows", () => {
  let captured = null;
  const outcome = terminateProcessTree(1234, {
    platform: "win32",
    runCommandImpl(command, args, options) {
      captured = { command, args, shell: options.shell };
      return {
        command,
        args,
        status: 0,
        signal: null,
        stdout: "",
        stderr: "",
        error: null
      };
    },
    killImpl() {
      throw new Error("kill fallback should not run");
    }
  });

  // shell must be false: Git Bash rewrites taskkill's /PID into a Windows path.
  assert.deepEqual(captured, {
    command: "taskkill",
    args: ["/PID", "1234", "/T", "/F"],
    shell: false
  });
  assert.equal(outcome.delivered, true);
  assert.equal(outcome.method, "taskkill");
});

// Claude Code runs the plugin through Git Bash on Windows, which exports SHELL. Only a real
// taskkill shows whether the tree died, so this one is skipped off Windows.
test("terminateProcessTree kills a real tree when SHELL points at Git Bash", { skip: process.platform !== "win32" }, async () => {
  const root = spawn(
    process.execPath,
    ["-e", "const { spawn } = require('node:child_process');" +
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], { stdio: 'ignore' });" +
      "process.stdout.write(String(child.pid) + '\\n');" +
      "setInterval(() => {}, 1e9);"],
    { stdio: ["ignore", "pipe", "ignore"], windowsHide: true }
  );

  const childPid = Number(await once(root.stdout, "data"));
  const previousShell = process.env.SHELL;
  process.env.SHELL = "C:\\Program Files\\Git\\bin\\bash.exe";
  try {
    terminateProcessTree(root.pid);
    assert.equal(await waitForExit(root.pid), true, "root process survived");
    assert.equal(await waitForExit(childPid), true, "child process survived");
  } finally {
    if (previousShell === undefined) {
      delete process.env.SHELL;
    } else {
      process.env.SHELL = previousShell;
    }
    for (const pid of [root.pid, childPid]) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone, which is what the assertions above expect.
      }
    }
  }
});

test("terminateProcessTree treats missing Windows processes as already stopped", () => {
  const outcome = terminateProcessTree(1234, {
    platform: "win32",
    runCommandImpl(command, args) {
      return {
        command,
        args,
        status: 128,
        signal: null,
        stdout: "ERROR: The process \"1234\" not found.",
        stderr: "",
        error: null
      };
    }
  });

  assert.equal(outcome.attempted, true);
  assert.equal(outcome.method, "taskkill");
  assert.equal(outcome.result.status, 128);
  assert.match(outcome.result.stdout, /not found/i);
});
