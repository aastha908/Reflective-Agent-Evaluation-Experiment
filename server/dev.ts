import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

const children: ChildProcess[] = [
  spawn(
    process.execPath,
    [resolve("node_modules/tsx/dist/cli.mjs"), "watch", "server/index.ts"],
    { stdio: "inherit" },
  ),
  spawn(
    process.execPath,
    [resolve("node_modules/vite/bin/vite.js"), "--host", "127.0.0.1"],
    { stdio: "inherit" },
  ),
];

const shutdown = () => {
  for (const child of children)
    if (child.pid && child.exitCode === null) child.kill("SIGTERM");
};
for (const child of children)
  child.on("exit", (code) => {
    if (code && code !== 0) process.exitCode = code;
    shutdown();
  });
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
