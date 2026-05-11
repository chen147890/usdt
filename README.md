# Universal PoW Miner

一个干净的新项目：输入项目网址，自动判断它属于哪种 PoW mint 类型，并给出正确的挖矿执行路径。

当前重点支持：

- `equium`：Solana + Equihash 96,5。使用官方 Rust CLI miner，多线程 CPU 挖矿，Mac/Ubuntu 通用。
- `hash256`：EVM + Keccak256 + WebGPU。已建 profile，后续可迁移旧项目里的 WebGPU kernel。
- `h98hash`：EVM + SHA-256 + bytes16 nonce。已建 profile，后续接入 SHA-256 kernel。

## 为什么 Equium 不走 WebGPU

Equium 官网和源码说明它使用 `Equihash 96,5`，瓶颈在内存而不是纯计算。每个线程大约占用 50 MB 内存，官方推荐桌面端或 Rust CLI。也就是说，Mac 和 Ubuntu 的性能路线是：

- 使用官方 Rust CLI。
- 按 CPU 线程和内存自动选择线程数。
- 使用稳定 Solana RPC，公共 RPC 只适合测试。

## 启动控制台

这个项目不依赖 Bun，直接用 Node：

```sh
cd /Users/laixingyun/Desktop/universal-pow-miner
npm start
```

打开：

```text
http://127.0.0.1:8088
```

Mac 快捷启动：

```sh
npm run mac
```

Ubuntu 快捷启动：

```sh
npm run ubuntu
```

## Equium CLI 挖矿

第一次先编译官方矿工：

```sh
cd /Users/laixingyun/Desktop/universal-pow-miner
cp .env.example .env
npm run equium:setup
```

编辑 `.env`：

```sh
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
SOLANA_KEYPAIR=runtime/keypairs/equium-id.json
# 也可以填 64-byte Solana 私钥，支持 base58 或无空格 JSON 数组：
# SOLANA_PRIVATE_KEY=
EQUIUM_THREADS=auto
EQUIUM_MAX_BLOCKS=0
EQUIUM_MAX_NONCES_PER_ROUND=4096
EQUIUM_START_TIME=03:00
EQUIUM_TIMEZONE=Asia/Shanghai
EQUIUM_WAIT_LOG_INTERVAL_SECONDS=300
EQUIUM_MINER_RESTART_SECONDS=60
EQUIUM_MIN_SOL_BALANCE=0.002
```

最简单部署只需要一条命令：

```sh
npm run deploy
```

这条命令会自动完成：

- 缺 `.env` 时复制 `.env.example`。
- 缺矿工二进制时执行 `equium:setup`。
- 如果填写了 `SOLANA_PRIVATE_KEY`，自动生成本地 keypair JSON。
- 启动时预检一次 RPC、钱包地址、SOL 余额。
- 后台启动常驻任务，到 `EQUIUM_TIMEZONE` 时区里的 `EQUIUM_START_TIME` 自动开挖。
- 如果官方 config/RPC 暂时没恢复导致矿工退出，会每 `EQUIUM_MINER_RESTART_SECONDS` 秒直接重启矿工，不再重复预检。
- 直接打开日志。

备用命令：

```sh
npm run equium:preflight
npm run mine
npm run mine:daemon
npm run mine:logs
npm run mine:stop
```

如果要绕过 3 点等待，立即挖：

```sh
npm run equium:run
```

`EQUIUM_THREADS=auto` 会按平台自动选择线程数：

- macOS：读取 `sysctl -n hw.logicalcpu` 和 `hw.memsize`。
- Ubuntu/Linux：读取 `nproc` 和 `getconf`。
- 线程上限按总内存 70% / 每线程约 64 MB 估算，再用逻辑核心数封顶。

## 钱包和费用

Equium 是 Solana 项目，CLI 使用 Solana keypair JSON 文件。钱包需要少量 SOL 支付交易费用。没有 keypair 时可用：

```sh
mkdir -p runtime/keypairs
solana-keygen new -o runtime/keypairs/equium-id.json
```

也可以把私钥填到 `SOLANA_PRIVATE_KEY`，`npm run deploy` 会自动生成本地 keypair 文件。不要用主钱包。建议新建专用挖矿钱包，只放少量 SOL。

## 验证

```sh
npm run check
```

## 文件结构

```text
universal-pow-miner/
  profiles.mjs              # 项目 profile：equium/hash256/h98hash
  server.mjs                # Node 控制台和识别 API
  public/                   # 本地网页控制台
  scripts/equium-setup.sh   # 拉取并编译官方 Equium CLI miner
  scripts/equium-run.sh     # Mac/Ubuntu 自动线程数启动 Equium miner
  scripts/equium-preflight.mjs
  scripts/equium-scheduler.mjs
  scripts/deploy.mjs
  scripts/mine-daemon.sh
  runtime/                  # 本地编译产物和源码缓存
```
