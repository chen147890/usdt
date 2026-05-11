import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  ROOT,
  formatPreflightResult,
  loadEnvFile,
  prepareSolanaKeypairFromEnv,
  runPreflight
} from "./equium-preflight.mjs";

const DEFAULT_START_TIME = "03:00";
const DEFAULT_PREFLIGHT_INTERVAL_SECONDS = 300;
const DEFAULT_START_RETRY_SECONDS = 30;

let minerProcess = null;

function log(message) {
  console.log(`[${new Date().toLocaleString()}] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function secondsFromEnv(name, fallback) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseStartTime(value) {
  const normalized = String(value || DEFAULT_START_TIME).trim().toLowerCase();
  if (["now", "immediate", "immediately"].includes(normalized)) return null;
  const match = normalized.match(/^(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?$/);
  if (!match) throw new Error(`Invalid EQUIUM_START_TIME: ${value}. Use HH:MM, for example 03:00 or 15:00.`);
  const hours = Number(match[1]);
  const minutes = Number(match[2] || "0");
  const seconds = Number(match[3] || "0");
  if (hours > 23 || minutes > 59 || seconds > 59) {
    throw new Error(`Invalid EQUIUM_START_TIME: ${value}. Use a 24-hour time.`);
  }
  return { hours, minutes, seconds };
}

function startTargetFromNow(startTime, now = new Date()) {
  const parsed = parseStartTime(startTime);
  if (!parsed) return null;
  const target = new Date(now);
  target.setHours(parsed.hours, parsed.minutes, parsed.seconds, 0);
  return target.getTime() <= now.getTime() ? null : target;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

async function checkOnce(label) {
  try {
    const result = await runPreflight();
    log(`${label}: OK. Wallet ${result.pubkey}, balance ${result.balanceSol.toFixed(9)} SOL.`);
    return true;
  } catch (error) {
    if (error.result) {
      log(`${label}: FAILED.`);
      console.error(formatPreflightResult(error.result));
    } else {
      log(`${label}: FAILED. ${error.message}`);
    }
    return false;
  }
}

async function waitUntilStartTime(target, intervalMs) {
  if (!target) {
    log("Start time has already arrived or EQUIUM_START_TIME=now. Mining will start after final preflight.");
    return;
  }

  log(`Waiting for mining start time: ${target.toLocaleString()}`);
  while (Date.now() < target.getTime()) {
    await checkOnce("Preflight");
    const remaining = target.getTime() - Date.now();
    if (remaining <= 0) break;
    const waitMs = Math.min(intervalMs, remaining);
    log(`Next check in ${formatDuration(waitMs)}. Remaining until start: ${formatDuration(remaining)}.`);
    await sleep(waitMs);
  }
}

async function finalPreflightLoop(retryMs) {
  let attempt = 1;
  while (true) {
    const ok = await checkOnce(`Final preflight #${attempt}`);
    if (ok) return;
    log(`Start time reached, but checks are not clean. Retrying in ${formatDuration(retryMs)}.`);
    attempt += 1;
    await sleep(retryMs);
  }
}

function startMiner() {
  const runner = join(ROOT, "scripts/equium-run.sh");
  log("Starting Equium miner now.");
  minerProcess = spawn("bash", [runner], {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit"
  });
  minerProcess.on("exit", (code, signal) => {
    if (signal) log(`Miner stopped by signal ${signal}.`);
    else log(`Miner exited with code ${code}.`);
    process.exit(code ?? 1);
  });
}

function stopMiner(signal) {
  log(`Received ${signal}; stopping scheduler.`);
  if (minerProcess && !minerProcess.killed) minerProcess.kill(signal);
  else process.exit(signal === "SIGINT" ? 130 : 143);
}

process.on("SIGINT", () => stopMiner("SIGINT"));
process.on("SIGTERM", () => stopMiner("SIGTERM"));

loadEnvFile();
try {
  const importedKeypair = prepareSolanaKeypairFromEnv();
  if (importedKeypair) log(`Prepared Solana keypair: ${importedKeypair}`);
} catch (error) {
  log(`Cannot prepare Solana keypair from private key: ${error.message}`);
  process.exit(1);
}

const startTime = process.env.EQUIUM_START_TIME || DEFAULT_START_TIME;
const target = startTargetFromNow(startTime);
const preflightIntervalMs = secondsFromEnv(
  "EQUIUM_PREFLIGHT_INTERVAL_SECONDS",
  DEFAULT_PREFLIGHT_INTERVAL_SECONDS
) * 1000;
const startRetryMs = secondsFromEnv(
  "EQUIUM_START_RETRY_SECONDS",
  DEFAULT_START_RETRY_SECONDS
) * 1000;

log(`Equium scheduler is running. Start time: ${startTime}.`);
await waitUntilStartTime(target, preflightIntervalMs);
await finalPreflightLoop(startRetryMs);
startMiner();
