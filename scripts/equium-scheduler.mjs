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
const DEFAULT_TIMEZONE = "Asia/Shanghai";
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

function validateTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    throw new Error(`Invalid EQUIUM_TIMEZONE: ${timeZone}. Use an IANA timezone, for example Asia/Shanghai.`);
  }
}

function zonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hours: parts.hour,
    minutes: parts.minute,
    seconds: parts.second
  };
}

function zonedDateToInstant(parts, timeZone) {
  const wanted = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hours,
    parts.minutes,
    parts.seconds,
    0
  );
  let instant = new Date(wanted);
  for (let index = 0; index < 3; index += 1) {
    const actual = zonedParts(instant, timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hours,
      actual.minutes,
      actual.seconds,
      0
    );
    const delta = wanted - actualAsUtc;
    if (delta === 0) break;
    instant = new Date(instant.getTime() + delta);
  }
  return instant;
}

function formatInTimeZone(date, timeZone) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

function startTargetFromNow(startTime, timeZone, now = new Date()) {
  const parsed = parseStartTime(startTime);
  if (!parsed) return null;
  const current = zonedParts(now, timeZone);
  const target = zonedDateToInstant({
    year: current.year,
    month: current.month,
    day: current.day,
    hours: parsed.hours,
    minutes: parsed.minutes,
    seconds: parsed.seconds
  }, timeZone);
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

async function waitUntilStartTime(target, intervalMs, timeZone) {
  if (!target) {
    log(`Start time has already arrived in ${timeZone}, or EQUIUM_START_TIME=now. Mining will start after final preflight.`);
    return;
  }

  log(`Waiting for mining start time: ${formatInTimeZone(target, timeZone)} (${timeZone}).`);
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
const timeZone = validateTimeZone(process.env.EQUIUM_TIMEZONE || DEFAULT_TIMEZONE);
const target = startTargetFromNow(startTime, timeZone);
const preflightIntervalMs = secondsFromEnv(
  "EQUIUM_PREFLIGHT_INTERVAL_SECONDS",
  DEFAULT_PREFLIGHT_INTERVAL_SECONDS
) * 1000;
const startRetryMs = secondsFromEnv(
  "EQUIUM_START_RETRY_SECONDS",
  DEFAULT_START_RETRY_SECONDS
) * 1000;

log(`Equium scheduler is running. Current time: ${formatInTimeZone(new Date(), timeZone)}. Start time: ${startTime} (${timeZone}).`);
await waitUntilStartTime(target, preflightIntervalMs, timeZone);
await finalPreflightLoop(startRetryMs);
startMiner();
