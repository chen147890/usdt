export const profiles = {
  equium: {
    id: "equium",
    name: "Equium / $EQM",
    projectUrl: "https://www.equium.xyz/",
    domains: ["equium.xyz", "www.equium.xyz"],
    chain: "solana",
    programId: "ZKGMUfxiRCXFPnqz9zgqAnuqJy15jk7fKbR4o6FuEQM",
    mint: "1MhvZzEe8gQ8Rb9CrT3Dn26Gkn9QRErzLMGkkTwveqm",
    proof: {
      algorithm: "Equihash",
      params: "96,5",
      engine: "external-cli",
      hardware: "cpu-memory-bound",
      memoryPerThreadMb: 50
    },
    run: {
      setupScript: "scripts/equium-setup.sh",
      runScript: "scripts/equium-run.sh",
      source: "https://github.com/HannaPrints/equium",
      package: "equium-cli-miner",
      binary: "equium-miner"
    },
    performance: {
      mac: "Use all practical CPU threads; Equihash is memory-bound, not WebGPU-bound.",
      ubuntu: "Use all practical CPU threads; prefer CLI on servers and a good Solana RPC."
    },
    autoRunnable: true,
    note: "Equium 是 Solana + Equihash 96,5，最佳路径是官方 Rust CLI 多线程 CPU 挖矿。"
  },
  hash256: {
    id: "hash256",
    name: "$HASH / hash256.fun",
    projectUrl: "https://hash256.fun/",
    domains: ["hash256.fun", "www.hash256.fun"],
    chain: "evm",
    chainId: 1,
    contract: "0xAC7b5d06fa1e77D08aea40d46cB7C5923A87A0cc",
    proof: {
      algorithm: "keccak256",
      input: "challenge || uint256 nonce",
      engine: "webgpu",
      hardware: "gpu-compute-bound"
    },
    submit: {
      functionName: "mine",
      signature: "mine(uint256)",
      value: "0"
    },
    autoRunnable: false,
    note: "适合 WebGPU 高速 kernel；可从旧 hash-bun-ubuntu-miner 迁移 GPU 内核。"
  },
  h98hash: {
    id: "h98hash",
    name: "HASH98 / h98hash.xyz",
    projectUrl: "https://www.h98hash.xyz/",
    domains: ["h98hash.xyz", "www.h98hash.xyz"],
    chain: "evm",
    chainId: 1,
    contract: "0x1E5adF70321CA28b3Ead70Eac545E6055E969e6f",
    proof: {
      algorithm: "sha256",
      input: "challenge || bytes16 nonce",
      engine: "webgpu-or-wasm",
      hardware: "gpu-or-cpu"
    },
    submit: {
      functionName: "mint",
      signature: "mint(bytes16)",
      valueFromConfig: "mintPrice"
    },
    autoRunnable: false,
    note: "已知是 SHA-256 + bytes16 nonce；需要对应 kernel 后才能自动开挖。"
  }
};

export const defaultProfileId = "equium";

export function listProfiles() {
  return Object.values(profiles);
}

export function getProfile(id) {
  return profiles[id] ?? null;
}

export function getProfileForUrl(rawUrl) {
  let host = "";
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  return Object.values(profiles).find((profile) => profile.domains.includes(host)) ?? null;
}
