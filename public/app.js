const $ = (id) => document.getElementById(id);

let config = null;
let activeProfile = null;

function log(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  $("log").textContent = `${line}\n${$("log").textContent}`.slice(0, 8000);
}

function warn(message) {
  $("warning").hidden = !message;
  $("warning").textContent = message || "";
}

function setStatus(value) {
  $("status").textContent = value;
}

function renderProfile(profile) {
  activeProfile = profile;
  $("profileName").textContent = profile ? profile.name : "-";
  $("profileType").textContent = profile ? profile.chain : "-";
  $("algorithm").textContent = profile ? `${profile.proof.algorithm}${profile.proof.params ? ` ${profile.proof.params}` : ""}` : "-";
  $("engine").textContent = profile ? profile.proof.engine : "-";
  $("target").textContent = profile ? (profile.programId || profile.contract || "-") : "-";
  warn(profile?.note || "");
}

function renderCommands(plan = config?.equium) {
  if (!activeProfile) {
    $("commands").textContent = "等待识别。";
    return;
  }
  if (activeProfile.id === "equium") {
    $("commands").textContent = [
      "# 最简单部署：自动编译、预检、后台等 3 点、打开日志",
      plan.deploy,
      "",
      "# 备用命令",
      "# 第一次：拉取并编译官方 Equium Rust CLI miner",
      plan.setup,
      "# 预检 RPC、矿工文件、钱包地址、钱包 SOL 余额",
      plan.preflight,
      `# 常驻等待，到 ${plan.startTime} 后自动挖矿`,
      plan.scheduledRun,
      "# 后台部署：启动、看日志、停止",
      plan.daemon,
      plan.logs,
      plan.stop,
      "",
      "# 立即挖矿。会自动按 Mac/Ubuntu CPU 和内存选择线程数",
      plan.run,
      "",
      "# 实际底层命令，RPC 已脱敏展示",
      plan.rawCommand
    ].join("\n");
    return;
  }
  $("commands").textContent = [
    `${activeProfile.name} 已识别。`,
    `算法：${activeProfile.proof.algorithm}`,
    `执行路径：${activeProfile.proof.engine}`,
    activeProfile.autoRunnable ? "可自动运行。" : "当前新项目先保留为识别/接入 profile；需要补对应内核或迁移旧 WebGPU 核心。"
  ].join("\n");
}

async function loadConfig() {
  const response = await fetch("/api/config", { cache: "no-store" });
  config = await response.json();
  $("projectUrl").value = config.defaultProjectUrl;
  $("threads").value = `${config.system.recommended.equiumThreads} threads`;
  $("system").textContent = `${config.system.platform}/${config.system.arch} · ${config.system.logicalCores} cores · ${config.system.totalMemMb} MB`;
  $("profileSelect").innerHTML = config.profiles
    .map((profile) => `<option value="${profile.id}">${profile.name}</option>`)
    .join("");
  $("profileSelect").value = config.defaultProfile.id;
  renderProfile(config.defaultProfile);
  renderCommands(config.equium);
  log("配置已加载。");
}

async function discover() {
  const url = $("projectUrl").value.trim();
  if (!url) return;
  setStatus("Scanning");
  const response = await fetch(`/api/discover?url=${encodeURIComponent(url)}`, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "识别失败");
  for (const finding of body.findings || []) log(finding);
  if (body.profile) {
    $("profileSelect").value = body.profile.id;
    renderProfile(body.profile);
    renderCommands();
    setStatus(body.ok ? "Matched" : "Unknown");
  } else {
    renderProfile(null);
    renderCommands();
    setStatus("Unknown");
  }
}

async function loadEquiumPlan() {
  setStatus("Planning");
  const response = await fetch("/api/equium/plan", { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "读取 Equium 方案失败");
  renderProfile(body.profile);
  renderCommands(body.plan);
  $("threads").value = `${body.plan.threads} threads`;
  log(`Equium 推荐线程：${body.plan.threads}`);
  setStatus("Ready");
}

$("discoverBtn").addEventListener("click", () => discover().catch((error) => {
  setStatus("Error");
  log(error.message);
}));

$("equiumPlanBtn").addEventListener("click", () => loadEquiumPlan().catch((error) => {
  setStatus("Error");
  log(error.message);
}));

$("profileSelect").addEventListener("change", () => {
  const profile = config.profiles.find((item) => item.id === $("profileSelect").value);
  renderProfile(profile);
  renderCommands();
});

loadConfig().catch((error) => {
  setStatus("Error");
  log(error.message);
});
