import { spawn } from 'node:child_process';

const apiProc = spawn(
  process.execPath,
  ['./node_modules/tsx/dist/cli.mjs', 'watch', 'server/index.ts'],
  { stdio: 'inherit', env: process.env }
);

const webProc = spawn(
  process.execPath,
  ['./node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173'],
  { stdio: 'inherit', env: process.env }
);

const cleanup = () => {
  if (!apiProc.killed) apiProc.kill('SIGTERM');
  if (!webProc.killed) webProc.kill('SIGTERM');
};

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

apiProc.on('exit', (code) => {
  if (code && code !== 0) {
    cleanup();
    process.exit(code);
  }
});
webProc.on('exit', (code) => {
  if (code && code !== 0) {
    cleanup();
    process.exit(code);
  }
});

