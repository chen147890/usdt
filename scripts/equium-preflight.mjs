import { accessSync, chmodSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";
const LAMPORTS_PER_SOL = 1_000_000_000;
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export class PreflightError extends Error {
  constructor(failures, result) {
    super(`Equium preflight failed:\n- ${failures.join("\n- ")}`);
    this.name = "PreflightError";
    this.failures = failures;
    this.result = result;
  }
}

export function loadEnvFile(root = ROOT) {
  const path = join(root, ".env");
  if (!existsSync(path)) return false;
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = expandEnv(rawValue);
  }
  return true;
}

export function expandEnv(value) {
  if (!value) return value;
  const expanded = value.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_match, key) => {
    if (key === "HOME") return process.env.HOME || homedir();
    return process.env[key] ?? "";
  });
  if (expanded === "~") return homedir();
  if (expanded.startsWith("~/")) return join(homedir(), expanded.slice(2));
  return expanded;
}

export function redactUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    for (const key of ["api-key", "apikey", "key", "token"]) {
      if (url.searchParams.has(key)) url.searchParams.set(key, "REDACTED");
    }
    return url.toString();
  } catch {
    return String(rawUrl).replace(/((?:api-key|apikey|key|token)=)[^&\s]+/gi, "$1REDACTED");
  }
}

function resolveLocalPath(path) {
  const expanded = expandEnv(path);
  return isAbsolute(expanded) ? expanded : join(ROOT, expanded);
}

export function getEquiumConfig() {
  const minSolBalance = Number(process.env.EQUIUM_MIN_SOL_BALANCE || "0.002");
  return {
    bin: resolveLocalPath(process.env.EQUIUM_MINER_BIN || "runtime/bin/equium-miner"),
    rpcUrl: process.env.SOLANA_RPC_URL || DEFAULT_RPC,
    keypair: resolveLocalPath(process.env.SOLANA_KEYPAIR || "runtime/keypairs/equium-id.json"),
    minSolBalance: Number.isFinite(minSolBalance) ? minSolBalance : 0.002
  };
}

function base58Encode(bytes) {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) + BigInt(byte);
  let encoded = "";
  while (value > 0n) {
    const remainder = Number(value % 58n);
    encoded = BASE58_ALPHABET[remainder] + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte === 0) encoded = "1" + encoded;
    else break;
  }
  return encoded || "1";
}

function base58Decode(value) {
  let decoded = 0n;
  for (const char of value) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit === -1) throw new Error("secret key is not valid base58");
    decoded = decoded * 58n + BigInt(digit);
  }

  const bytes = [];
  while (decoded > 0n) {
    bytes.unshift(Number(decoded & 255n));
    decoded >>= 8n;
  }
  for (const char of value) {
    if (char === "1") bytes.unshift(0);
    else break;
  }
  return bytes;
}

function keypairArrayFromJson(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.secretKey)) return parsed.secretKey;
  if (Array.isArray(parsed?._keypair?.secretKey)) return parsed._keypair.secretKey;
  return null;
}

function secretKeyFromText(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.startsWith("[") || raw.startsWith("{")) {
    return keypairArrayFromJson(JSON.parse(raw));
  }
  return base58Decode(raw);
}

function validateSecretKey(secretKey) {
  if (!Array.isArray(secretKey)) throw new Error("SOLANA_PRIVATE_KEY must be a JSON array or base58 secret key");
  if (!secretKey.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
    throw new Error("SOLANA_PRIVATE_KEY contains invalid byte values");
  }
  if (secretKey.length !== 64) {
    throw new Error(`SOLANA_PRIVATE_KEY must be a 64-byte Solana secret key; got ${secretKey.length} bytes`);
  }
  return secretKey;
}

export function prepareSolanaKeypairFromEnv() {
  const raw = process.env.SOLANA_PRIVATE_KEY || process.env.SOLANA_SECRET_KEY || process.env.SOLANA_KEYPAIR_JSON;
  if (!raw) return null;

  const secretKey = validateSecretKey(secretKeyFromText(raw));
  const output = resolveLocalPath(process.env.SOLANA_KEYPAIR || "runtime/keypairs/equium-id.json");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(secretKey)}\n`, { mode: 0o600 });
  try {
    chmodSync(output, 0o600);
  } catch {
    // Some filesystems do not support chmod; the keypair path is still local and gitignored.
  }
  process.env.SOLANA_KEYPAIR = output;
  return output;
}

function pubkeyFromSolanaCli(keypairPath) {
  const result = spawnSync("solana-keygen", ["pubkey", keypairPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) return null;
  const pubkey = result.stdout.trim();
  return pubkey || null;
}

export function readSolanaPubkey(keypairPath) {
  const raw = readFileSync(keypairPath, "utf8");
  const parsed = JSON.parse(raw);
  const keypair = keypairArrayFromJson(parsed);
  if (!keypair) throw new Error("keypair JSON is not a Solana secret-key array");
  if (!keypair.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
    throw new Error("keypair JSON contains invalid byte values");
  }
  if (keypair.length >= 64) return base58Encode(keypair.slice(32, 64));
  const cliPubkey = pubkeyFromSolanaCli(keypairPath);
  if (cliPubkey) return cliPubkey;
  throw new Error("keypair has no embedded public key, and solana-keygen is unavailable");
}

async function rpcCall(rpcUrl, method, params = [], timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "universal-pow-miner", method, params })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(body.error.message || JSON.stringify(body.error));
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

export function checkMinerBinary(path, failures = []) {
  if (!existsSync(path)) {
    failures.push(`miner binary is missing: ${path}. Run: npm run equium:setup`);
    return false;
  }
  try {
    accessSync(path, constants.X_OK);
  } catch {
    failures.push(`miner binary is not executable: ${path}`);
    return false;
  }
  const result = spawnSync(path, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5000
  });
  if (result.error) {
    failures.push(`miner binary cannot run on this machine: ${result.error.message}. Run: npm run equium:setup`);
    return false;
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    failures.push(`miner binary failed its runtime check${detail ? `: ${detail}` : ""}. Run: npm run equium:setup`);
    return false;
  }
  return true;
}

export async function runPreflight() {
  const config = getEquiumConfig();
  const failures = [];
  const result = {
    ok: false,
    rpcUrl: redactUrl(config.rpcUrl),
    keypair: config.keypair,
    minerBin: config.bin,
    minSolBalance: config.minSolBalance,
    pubkey: null,
    balanceSol: null,
    version: null,
    failures
  };

  checkMinerBinary(config.bin, failures);

  if (!existsSync(config.keypair)) {
    failures.push(`Solana keypair is missing: ${config.keypair}`);
  } else {
    try {
      result.pubkey = readSolanaPubkey(config.keypair);
    } catch (error) {
      failures.push(`cannot read Solana keypair: ${error.message}`);
    }
  }

  try {
    const version = await rpcCall(config.rpcUrl, "getVersion");
    result.version = version?.["solana-core"] || "unknown";
  } catch (error) {
    failures.push(`RPC check failed at ${result.rpcUrl}: ${error.message}`);
  }

  if (result.pubkey) {
    try {
      const balance = await rpcCall(config.rpcUrl, "getBalance", [
        result.pubkey,
        { commitment: "confirmed" }
      ]);
      const lamports = Number(balance?.value ?? 0);
      result.balanceSol = lamports / LAMPORTS_PER_SOL;
      if (Number.isFinite(config.minSolBalance) && result.balanceSol < config.minSolBalance) {
        failures.push(`wallet balance is ${result.balanceSol.toFixed(9)} SOL, below ${config.minSolBalance} SOL`);
      }
    } catch (error) {
      failures.push(`wallet balance check failed: ${error.message}`);
    }
  }

  result.ok = failures.length === 0;
  if (!result.ok) throw new PreflightError(failures, result);
  return result;
}

export function formatPreflightResult(result) {
  const lines = [
    `Status:    ${result.ok ? "OK" : "FAILED"}`,
    `RPC:       ${result.rpcUrl}`,
    `Version:   ${result.version || "-"}`,
    `Keypair:   ${result.keypair}`,
    `Wallet:    ${result.pubkey || "-"}`,
    `Balance:   ${result.balanceSol === null ? "-" : `${result.balanceSol.toFixed(9)} SOL`}`,
    `Min SOL:   ${result.minSolBalance}`,
    `Miner:     ${result.minerBin}`
  ];
  if (result.failures?.length) {
    lines.push("", "Failures:");
    for (const failure of result.failures) lines.push(`- ${failure}`);
  }
  return lines.join("\n");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  loadEnvFile();
  try {
    const importedKeypair = prepareSolanaKeypairFromEnv();
    if (importedKeypair) console.log(`Prepared Solana keypair: ${importedKeypair}`);
  } catch (error) {
    console.error(`Cannot prepare Solana keypair from private key: ${error.message}`);
    process.exit(1);
  }
  runPreflight()
    .then((result) => {
      console.log(formatPreflightResult(result));
    })
    .catch((error) => {
      if (error.result) console.error(formatPreflightResult(error.result));
      else console.error(error.message);
      process.exit(1);
    });
}
