import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { makeTempDir } from "./helpers.mjs";
import { ensureBrokerSession, saveBrokerSession, loadBrokerSession } from "../plugins/codex/scripts/lib/broker-lifecycle.mjs";

test("ensureBrokerSession reuses a live broker whose endpoint does not answer the probe", async () => {
  const workspace = makeTempDir();
  // Use this test process as the "broker": it is unquestionably alive and it is not
  // listening on the endpoint, so the readiness probe must fail. A broker that is
  // mid-turn behaves the same way — its event loop is busy and it misses the probe
  // window. Failing the probe must not be treated as "the broker is gone".
  // Keep the broker's own session dir separate from the workspace: the buggy path
  // unlinks sessionDir, and we still need the workspace to exist afterwards.
  const sessionDir = path.join(workspace, "broker-session");
  fs.mkdirSync(sessionDir, { recursive: true });
  const session = {
    endpoint: "unix:/tmp/codex-plugin-test-not-listening/broker.sock",
    pidFile: path.join(sessionDir, "broker.pid"),
    logFile: path.join(sessionDir, "broker.log"),
    sessionDir,
    pid: process.pid
  };
  fs.writeFileSync(session.pidFile, String(process.pid));
  fs.writeFileSync(session.logFile, "");
  saveBrokerSession(workspace, session);

  let killed = false;
  const result = await ensureBrokerSession(workspace, {
    killProcess: () => {
      killed = true;
    }
  });

  assert.equal(killed, false, "a live broker must never be killed after a failed probe");
  assert.equal(result?.pid, process.pid, "the live broker session must be reused");
  assert.equal(loadBrokerSession(workspace)?.pid, process.pid, "its state must be kept");
  assert.equal(fs.existsSync(session.logFile), true, "its log must not be unlinked");
});

test("ensureBrokerSession serializes concurrent callers so only one broker is created", async () => {
  const workspace = makeTempDir();
  const created = [];
  let counter = 0;

  // Both callers start with no persisted session. Without the lock they each spawn a
  // broker and the last writer wins, orphaning the other broker and its app-server.
  const options = {
    createBrokerEndpoint: (sessionDir) => `unix:${sessionDir}/broker.sock`,
    scriptPath: path.join(workspace, "fake-broker.mjs"),
    timeoutMs: 1000
  };
  fs.writeFileSync(
    options.scriptPath,
    [
      'import net from "node:net";',
      'const endpointIndex = process.argv.indexOf("--endpoint");',
      'const target = process.argv[endpointIndex + 1].replace(/^unix:/, "");',
      "net.createServer(() => {}).listen(target);",
      "setTimeout(() => {}, 60000);"
    ].join("\n")
  );

  const spy = { ...options, onSpawn: () => created.push(++counter) };
  const [a, b] = await Promise.all([
    ensureBrokerSession(workspace, spy),
    ensureBrokerSession(workspace, spy)
  ]);

  assert.ok(a, "first caller must get a session");
  assert.ok(b, "second caller must get a session");
  assert.equal(a.endpoint, b.endpoint, "concurrent callers must share one broker");

  for (const session of [a, b]) {
    try {
      if (session?.pid) process.kill(session.pid);
    } catch {
      // Already gone.
    }
  }
});
