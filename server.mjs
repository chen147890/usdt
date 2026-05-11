import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { defaultProfileId, getProfile, getProfileForUrl, listProfiles } from "./profiles.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC = join(ROOT, "public");

function expandEnv(value) {
  if (!value) return value;
  const expanded = value.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_match, key) => {
    if (key === "HOME") return process.env.HOME || os.homedir();
    return process.env[key] ?? "";
  });
  if (expanded === "~") return os.homedir();
  if (expanded.startsWith("~/")) return join(os.homedir(), expanded.slice(2));
  return expanded;
}

function loadEnvFile() {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) return;
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = expandEnv(trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, ""));
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile();

const PORT = Number(process.env.PORT || "8088");
const DEFAULT_PROFILE = getProfile(process.env.PROFILE_ID || defaultProfileId) ?? getProfile(defaultProfileId);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function redactUrl(rawUrl) {
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

function systemInfo() {
  const totalMemMb = Math.floor(os.totalmem() / 1024 / 1024);
  const freeMemMb = Math.floor(os.freemem() / 1024 / 1024);
  const logicalCores = os.cpus().length || 1;
  const equiumThreadsByMemory = Math.max(1, Math.floor((totalMemMb * 0.7) / 64));
  const equiumThreads = Math.max(1, Math.min(logicalCores, equiumThreadsByMemory));
  return {
    platform: os.platform(),
    arch: os.arch(),
    logicalCores,
    totalMemMb,
    freeMemMb,
    recommended: {
      equiumThreads,
      equiumMemoryPerThreadMb: 50,
      note: "按总内存 70% 和每线程约 50MB 估算，并以逻辑核心数封顶。"
    }
  };
}

async function fetchText(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "universal-pow-miner/0.1" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function absoluteAssetUrl(baseUrl, asset) {
  try {
    return new URL(asset, baseUrl).toString();
  } catch {
    return null;
  }
}

async function scanUrl(rawUrl) {
  const known = getProfileForUrl(rawUrl);
  if (known) {
    return {
      ok: true,
      confidence: 1,
      source: "known-domain",
      profile: known,
      findings: [`域名命中已知 profile：${known.id}`]
    };
  }

  const html = await fetchText(rawUrl);
  const assetUrls = unique(
    [...html.matchAll(/(?:src|href)=["']([^"']+\.js(?:\?[^"']*)?)["']/gi)]
      .map((match) => absoluteAssetUrl(rawUrl, match[1]))
  ).slice(0, 8);

  const bundleTexts = [];
  for (const assetUrl of assetUrls) {
    try {
      bundleTexts.push(await fetchText(assetUrl, 10000));
    } catch {
      // Ignore optional bundles during discovery.
    }
  }
  const text = [html, ...bundleTexts].join("\n");
  const lower = text.toLowerCase();
  const addresses = unique(text.match(/0x[a-fA-F0-9]{40}/g) ?? []);
  const solanaAddresses = unique(text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g) ?? [])
    .filter((value) => /[A-Z]/.test(value) && /[a-z]/.test(value))
    .slice(0, 20);
  const functionNames = unique([...text.matchAll(/functionName:`([^`]+)`|name:`([^`]+)`/g)]
    .map((match) => match[1] || match[2]));

  if (lower.includes("equihash") || lower.includes("equium") || lower.includes("zk5") || text.includes("ZKGMUfxiRCXFPnqz9zgqAnuqJy15jk7fKbR4o6FuEQM")) {
    return {
      ok: true,
      confidence: 0.86,
      source: "content-scan",
      profile: getProfile("equium"),
      findings: [
        "发现 Equium/Equihash/Solana 特征，适合使用官方 Rust CLI 多线程 CPU miner。",
        "这类项目不是 WebGPU 哈希循环，Mac/Ubuntu 都应走 CPU + 内存调参。"
      ],
      solanaAddresses
    };
  }

  if (functionNames.includes("getChallenge") && functionNames.includes("miningState") && functionNames.includes("mine")) {
    return {
      ok: true,
      confidence: 0.7,
      source: "content-scan",
      profile: getProfile("hash256"),
      findings: ["发现 getChallenge/miningState/mine，疑似 HASH256 同类 EVM PoW。"],
      evmAddresses: addresses
    };
  }

  if (functionNames.includes("challengeFor") && functionNames.includes("getConfig") && functionNames.includes("mint")) {
    return {
      ok: true,
      confidence: 0.7,
      source: "content-scan",
      profile: getProfile("h98hash"),
      findings: ["发现 challengeFor/getConfig/mint，疑似 H98 同类 EVM PoW。"],
      evmAddresses: addresses
    };
  }

  return {
    ok: false,
    confidence: 0,
    source: "content-scan",
    profile: null,
    findings: ["没有命中已支持协议，需要新增 profile/adapter。"],
    evmAddresses: addresses.slice(0, 12),
    solanaAddresses,
    functionNames: functionNames.slice(0, 40)
  };
}

function equiumPlan() {
  const info = systemInfo();
  const threads = process.env.EQUIUM_THREADS && process.env.EQUIUM_THREADS !== "auto"
    ? Number(process.env.EQUIUM_THREADS)
    : info.recommended.equiumThreads;
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const safeRpcUrl = redactUrl(rpcUrl);
  const keypair = process.env.SOLANA_KEYPAIR || "runtime/keypairs/equium-id.json";
  const maxBlocks = process.env.EQUIUM_MAX_BLOCKS || "0";
  const maxNonces = process.env.EQUIUM_MAX_NONCES_PER_ROUND || "4096";
  const startTime = process.env.EQUIUM_START_TIME || "03:00";
  const timeZone = process.env.EQUIUM_TIMEZONE || "Asia/Shanghai";
  return {
    deploy: "npm run deploy",
    setup: "npm run equium:setup",
    preflight: "npm run equium:preflight",
    scheduledRun: "npm run mine",
    daemon: "npm run mine:daemon",
    logs: "npm run mine:logs",
    stop: "npm run mine:stop",
    run: "npm run equium:run",
    rawCommand: [
      "runtime/bin/equium-miner",
      `--rpc-url '${safeRpcUrl}'`,
      `--keypair '${keypair}'`,
      `--threads ${threads}`,
      `--max-nonces-per-round ${maxNonces}`,
      maxBlocks !== "0" ? `--max-blocks ${maxBlocks}` : ""
    ].filter(Boolean).join(" "),
    threads,
    rpcUrl: safeRpcUrl,
    keypair,
    startTime,
    timeZone,
    maxBlocks,
    maxNonces
  };
}

async function serveStatic(res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safe = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(PUBLIC, safe);
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
  try {
    if (url.pathname === "/health") return json(res, 200, { ok: true });
    if (url.pathname === "/api/config") {
      return json(res, 200, {
        defaultProfile: DEFAULT_PROFILE,
        defaultProjectUrl: process.env.PROJECT_URL || DEFAULT_PROFILE.projectUrl,
        profiles: listProfiles(),
        system: systemInfo(),
        equium: equiumPlan()
      });
    }
    if (url.pathname === "/api/discover") {
      const target = url.searchParams.get("url");
      if (!target) return json(res, 400, { error: "缺少 url 参数" });
      return json(res, 200, await scanUrl(target));
    }
    if (url.pathname === "/api/equium/plan") {
      return json(res, 200, { profile: getProfile("equium"), system: systemInfo(), plan: equiumPlan() });
    }
    await serveStatic(res, url);
  } catch (error) {
    json(res, 500, { error: error?.message || String(error) });
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Universal PoW Miner: http://127.0.0.1:${PORT}`);
  console.log(`Default project: ${process.env.PROJECT_URL || DEFAULT_PROFILE.projectUrl}`);
});
