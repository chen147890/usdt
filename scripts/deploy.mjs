import { existsSync, copyFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  ROOT,
  checkMinerBinary,
  formatPreflightResult,
  getEquiumConfig,
  loadEnvFile,
  prepareSolanaKeypairFromEnv,
  runPreflight
} from "./equium-preflight.mjs";

function log(message) {
  console.log(`[deploy] ${message}`);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function ensureEnvFile() {
  const envFile = join(ROOT, ".env");
  const exampleFile = join(ROOT, ".env.example");
  if (!existsSync(envFile) && existsSync(exampleFile)) {
    copyFileSync(exampleFile, envFile);
    log("Created .env from .env.example. Fill SOLANA_RPC_URL and wallet settings, then run npm run deploy again.");
    process.exit(1);
  }
}

function ensureKeypair() {
  const keypair = prepareSolanaKeypairFromEnv();
  if (keypair) log(`Prepared Solana keypair from SOLANA_PRIVATE_KEY: ${keypair}`);
}

function ensureMiner() {
  const { bin } = getEquiumConfig();
  const failures = [];
  if (existsSync(bin) && checkMinerBinary(bin, failures)) {
    log(`Miner already exists and matches this machine: ${bin}`);
    return;
  }
  if (failures.length) {
    log(`Miner binary needs rebuild: ${failures[0]}`);
  } else {
    log("Miner binary is missing.");
  }
  log("Running npm run equium:setup now.");
  run("bash", ["scripts/equium-setup.sh"]);
}

async function ensurePreflight() {
  try {
    const result = await runPreflight();
    console.log(formatPreflightResult(result));
  } catch (error) {
    if (error.result) console.error(formatPreflightResult(error.result));
    else console.error(error.message);
    process.exit(1);
  }
}

function startDaemon() {
  log("Starting 3 o'clock scheduler in the background.");
  run("bash", ["scripts/mine-daemon.sh", "start"]);
}

function followLogs() {
  if (process.env.EQUIUM_DEPLOY_NO_LOGS === "1") return;
  log("Following logs. Press Ctrl+C to stop viewing logs; mining scheduler keeps running.");
  const child = spawn("bash", ["scripts/mine-daemon.sh", "logs"], {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit"
  });
  child.on("exit", (code, signal) => {
    if (signal === "SIGINT") process.exit(0);
    process.exit(code ?? 0);
  });
}

ensureEnvFile();
loadEnvFile();
ensureKeypair();
ensureMiner();
await ensurePreflight();
process.env.EQUIUM_SKIP_STARTUP_PREFLIGHT = "1";
startDaemon();
followLogs();
