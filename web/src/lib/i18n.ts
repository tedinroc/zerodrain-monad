export type Locale = "zh-CN" | "zh-TW" | "en";

export const LOCALE_LABELS: Record<Locale, string> = {
  "zh-CN": "简",
  "zh-TW": "繁",
  en: "EN",
};

export interface Dictionary {
  brandName: string;
  tagline: string;
  chainBadge: string;
  modeNormal: string;
  modeTripped: string;
  demoWallet: string;
  metamaskWallet: string;
  resetBtn: string;
  resettingBtn: string;
  explorerBtn: string;

  steps: [string, string, string, string];

  vaultLabel: string;
  vaultTitle: string;
  vaultBalance: string;
  passkeyStatus: string;
  passkeyBound: string;
  passkeyOutdated: string;
  passkeyUnbound: string;
  depositQuick: string;
  depositing: string;

  step1Hint: string;
  step1BtnWebAuthn: string;
  step1BtnWebCrypto: string;
  step1Busy: string;
  step1DepositHint: string;
  step1DepositBtn: string;
  step1LowWalletHint: (walletBal: string) => string;
  switchToDemoBtn: string;

  step2Hint: string;
  step2Btn: string;
  step2Busy: string;

  hijackBannerTitle: string;
  hijackBannerDesc: string;

  step3Hint: string;
  step3Btn: string;
  step3Busy: string;

  blockedTitle: string;
  blockedSub: string;
  blockedRevertLabel: string;
  blockedTargetLabel: string;
  blockedLossValue: string;

  step4Hint: string;
  step4NeedBindHint: string;
  step4BtnWebAuthn: string;
  step4BtnWebCrypto: string;
  step4Busy: string;
  switchToFallback: string;
  switchToBiometric: string;
  safeRecipientLocked: string;

  recoveredTitle: string;
  recoveredSub: string;
  replayBtn: string;
  viewTx: string;

  proofTitle: string;
  proofSub: string;
  rowSriTitle: string;
  rowSriOk: string;
  rowSriDrift: string;
  rowTraceTitle: string;
  rowTraceOk: string;
  rowTraceHijacked: string;
  rowBreakerTitle: string;
  rowBreakerStandby: string;
  rowBreakerTripped: string;
  rowPrecompileTitle: string;
  rowPrecompileActive: string;
  rpcUnavailable: string;
  viewVerifiedRecoveries: (count: string) => string;
  verifyGasLabel: string;

  metricTrips: string;
  metricRecoveries: string;
  metricGas: string;

  auditTitle: string;
  auditEmpty: string;

  detailsToggle: string;
  whyMonadTitle: string;
  whyMonadBody: string;
  boundaryTitle: string;
  boundaryBody: string;
  businessTitle: string;
  businessBody: string;

  toastDepositOk: (ms: number) => string;
  toastBindOk: (ms: number) => string;
  toastBindNeedDeposit: (ms: number) => string;
  toastTrippedOk: (ms: number) => string;
  toastAlreadyTripped: string;
  toastBlockedOk: string;
  toastRecoveredOk: (ms: number) => string;
  toastResetOk: (ms: number) => string;
  toastNoMetaMask: string;
  toastMetaMaskConnected: (addr: string) => string;
  toastNeedBind: string;
  toastBindHintFallback: string;

  logDeposit: string;
  logBindWebAuthn: string;
  logBindWebCrypto: string;
  logTripped: (ms: number) => string;
  logBlocked: string;
  logNormalWithdraw: string;
  logEscapedWebAuthn: string;
  logEscapedWebCrypto: string;
  logReset: string;
}

export const DICTIONARIES: Record<Locale, Dictionary> = {
  "zh-CN": {
    brandName: "ZeroDrain 零盗盾",
    tagline: "DeFi 前端 DNS 劫持亚秒级链上熔断 × EIP-7951 硬件 Passkey 防火墙",
    chainBadge: "Monad 测试网 #10143",
    modeNormal: "正常运行",
    modeTripped: "已熔断 · 仅硬件放行",
    demoWallet: "免钱包演练",
    metamaskWallet: "MetaMask",
    resetBtn: "重置",
    resettingBtn: "重置中",
    explorerBtn: "已验证合约",

    steps: ["1. 绑定硬件密钥", "2. 模拟 DNS 劫持", "3. 验证拦截盗币", "4. 硬件逃生取回"],

    vaultLabel: "受保护的目标协议前端",
    vaultTitle: "Monad Staking Vault",
    vaultBalance: "金库余额",
    passkeyStatus: "硬件密钥",
    passkeyBound: "已绑定",
    passkeyOutdated: "需重新绑定",
    passkeyUnbound: "未绑定",
    depositQuick: "+ 存入 0.1 MON",
    depositing: "存入中...",

    step1Hint: "先在本地设备生成硬件 Passkey（TouchID / FaceID）并注册公钥上链，演练模式会自动确保金库有余额。",
    step1BtnWebAuthn: "绑定 TouchID / FaceID 并准备演练",
    step1BtnWebCrypto: "绑定 P-256 备用密钥并准备演练",
    step1Busy: "正在注册上链...",
    step1DepositHint: "硬件密钥已绑定上链！当前金库余额不足 0.05 MON，请点击下方按钮存入 0.1 MON 以解锁后续劫持与逃生演练。",
    step1DepositBtn: "存入 0.1 MON 并继续演练",
    step1LowWalletHint: (bal) => `检测到当前 MetaMask 余额仅 ${bal} MON（需 ≥ 0.11 MON 支付存币与 Gas），可直接切换免钱包模式零门槛体验。`,
    switchToDemoBtn: "切换至「免钱包演练」继续体验",

    step2Hint: "点击下方按钮模拟真实 Name.com DNS 劫持：页面外观完全不变，但提款目标将被暗中篡改为黑客地址。",
    step2Btn: "模拟 Name.com DNS 劫持攻击",
    step2Busy: "哨兵正在检测并触发亚秒熔断...",

    hijackBannerTitle: "前端已被暗中劫持（上帝视角）",
    hijackBannerDesc: "提款按钮底层收款人已被替换为黑客地址 0xdead...bad1",

    step3Hint: "ZeroDrain 哨兵已比对托管 JS 并将合约降级为 PASSKEY_ONLY 模式。点击提款，验证恶意提款会在预检模拟阶段即遭链上合约 Revert 拒绝！",
    step3Btn: "点击被劫持的「提款 0.05 MON」",
    step3Busy: "发送至 Monad 测试网验证拦截...",

    blockedTitle: "恶意提款预检模拟已遭合约拒绝（未浪费 Gas 上链）",
    blockedSub: "已预绑且持有有效 Passkey 的存户资金不被冻结，可通过下方硬件逃生舱取回。",
    blockedRevertLabel: "预检模拟 Revert",
    blockedTargetLabel: "被阻断的黑客地址",
    blockedLossValue: "模拟结果: 0 MON 转出",

    step4Hint: "合约层强制锁死只向本人地址（或 NORMAL 期预绑定的冷钱包）放款——前端根本无法传入任意收款人，彻底化解签名前 WYSIWYS 篡改！",
    step4NeedBindHint: "🔒 安全机制生效：熔断期间合约已彻底冻结 Passkey 更换（防止被劫持前端诱骗覆盖密钥）。点击下方重置后即可绑定本机密钥开始演练。",
    step4BtnWebAuthn: "按 TouchID / FaceID 经 0x0100 安全取回",
    step4BtnWebCrypto: "用 P-256 经 0x0100 预编译安全取回",
    step4Busy: "等待硬件签名与 0x0100 链上验签...",
    switchToFallback: "无指纹/面容？切换 WebCrypto P-256 备用",
    switchToBiometric: "切换回真实 TouchID / FaceID 模式",
    safeRecipientLocked: "锁定收款地址",

    recoveredTitle: "0x0100 原生预编译验签通过！资金已安全取回",
    recoveredSub: "完整攻防闭环已实时验证于 Monad Testnet (#10143)。",
    replayBtn: "重置并再演练一次",
    viewTx: "查看链上交易",

    proofTitle: "实时链上防御证据",
    proofSub: "所有检测、熔断与 0x0100 验签均实时运行于 Monad 测试网",
    rowSriTitle: "前端 SRI 完整性指纹",
    rowSriOk: "指纹一致（clean.js）",
    rowSriDrift: "哈希漂移！检测到恶意注入脚本",
    rowTraceTitle: "交易前追踪（debug_traceCall）",
    rowTraceOk: "收款人正常（指向用户本人）",
    rowTraceHijacked: "收款人遭篡改 -> 0xdead...bad1",
    rowBreakerTitle: "链上熔断（Sync RPC 广播至收执）",
    rowBreakerStandby: "待机监控中（未触发，暂无实测耗时）",
    rowBreakerTripped: "已生效 PASSKEY_ONLY",
    rowPrecompileTitle: "EIP-7951 (0x0100) 预编译",
    rowPrecompileActive: "链上原生激活 · 单次验签 6,900 gas",
    rpcUnavailable: "RPC 暂无法确认",
    viewVerifiedRecoveries: (n) => `查看链上已验证逃生记录（累计 ${n} 笔）`,
    verifyGasLabel: "0x0100 单次验签 6,900 gas",

    metricTrips: "累计熔断",
    metricRecoveries: "0x0100 逃生",
    metricGas: "当前 Gas",

    auditTitle: "最近链上记录",
    auditEmpty: "按照左侧引导完成第 1 步，实时 Monad 测试网交易哈希将出现在这里。",

    detailsToggle: "评委参考：架构边界、Monad 特性与商业模型",
    whyMonadTitle: "为何必须建在 Monad？",
    whyMonadBody: "依托 MIP-12 300ms 出块 / 600ms 最终确定性与 eth_sendRawTransactionSync，哨兵比对托管 JS 异常后可在亚秒级（广播至收执实测）完成链上熔断，并调用原生 0x0100 预编译以单次验签 6,900 gas 验证 TouchID / FaceID。",
    boundaryTitle: "两层防御边界（已绑 Passkey 零冻结）",
    boundaryBody: "① 协议层（本机实测）：降级为 PASSKEY_ONLY，已预绑有效 Passkey 的存户可随时逃生取回；② 钱包层延伸：同套 0x0100 模块可挂载为 EIP-7702 Guard Hook 拦截恶意 ERC-20 approve。",
    businessTitle: "可持续商业模型",
    businessBody: "B2B DeFi 安全护盾月度订阅（按 TVL 分层）+ 去中心化白帽哨兵质押抢单分润 + 链上保险保费折扣合作。",

    toastDepositOk: (ms) => `成功存入 0.10 MON（确认耗时 ${ms} ms）`,
    toastBindOk: (ms) => `硬件公钥已上链注册（耗时 ${ms} ms），请点击第 2 步发起劫持演练！`,
    toastBindNeedDeposit: (ms) => `硬件公钥已注册（耗时 ${ms} ms）！请点击下方按钮存入 0.1 MON 完成金库准备。`,
    toastTrippedOk: (ms) => `侦测到 DNS 劫持！哨兵已于 ${ms} ms 在链上触发熔断，请点击提款测试拦截！`,
    toastAlreadyTripped: "合约已处于 PASSKEY_ONLY 保护中，可直接点击提款测试拦截！",
    toastBlockedOk: "拦截成功！恶意的 Drainer 提款已遭链上 Revert，请用硬件逃生取回资金。",
    toastRecoveredOk: (ms) => `0x0100 预编译验签成功！0.05 MON 已安全退回本机地址（${ms} ms）`,
    toastResetOk: (ms) => `已重置为 NORMAL 安全状态（${ms} ms），随时可重新演练。`,
    toastNoMetaMask: "未检测到浏览器钱包插件，请直接使用「免钱包演练」模式体验真实上链。",
    toastMetaMaskConnected: (addr) => `已连接 MetaMask (${addr}) 至 Monad Testnet`,
    toastNeedBind: "请先完成第 1 步绑定硬件密钥。",
    toastBindHintFallback: "若当前设备不支持生物识别，可点击下方切换为「WebCrypto P-256 备用模式」。",

    logDeposit: "存入 0.10 MON 至金库",
    logBindWebAuthn: "链上绑定 TouchID / FaceID 公钥",
    logBindWebCrypto: "链上绑定 WebCrypto P-256 公钥",
    logTripped: (ms) => `检测到 DNS 劫持 · ${ms} ms 链上熔断`,
    logBlocked: "Drainer 提款遭合约 Revert 拦截（损失 0 MON）",
    logNormalWithdraw: "正常模式提款 0.05 MON 成功",
    logEscapedWebAuthn: "TouchID / FaceID 经 0x0100 验签取回 0.05 MON",
    logEscapedWebCrypto: "WebCrypto P-256 经 0x0100 验签取回 0.05 MON",
    logReset: "DNS 已清理 · 重置为 NORMAL 模式",
  },

  "zh-TW": {
    brandName: "ZeroDrain 零盜盾",
    tagline: "DeFi 前端 DNS 劫持亞秒級鏈上熔斷 × EIP-7951 硬體 Passkey 防火牆",
    chainBadge: "Monad 測試網 #10143",
    modeNormal: "正常運行",
    modeTripped: "已熔斷 · 僅硬體放行",
    demoWallet: "免錢包演練",
    metamaskWallet: "MetaMask",
    resetBtn: "重置",
    resettingBtn: "重置中",
    explorerBtn: "已驗證合約",

    steps: ["1. 綁定硬體密鑰", "2. 模擬 DNS 劫持", "3. 驗證攔截盜幣", "4. 硬體逃生取回"],

    vaultLabel: "受保護的目標協議前端",
    vaultTitle: "Monad Staking Vault",
    vaultBalance: "金庫餘額",
    passkeyStatus: "硬體密鑰",
    passkeyBound: "已綁定",
    passkeyOutdated: "需重新綁定",
    passkeyUnbound: "未綁定",
    depositQuick: "+ 存入 0.1 MON",
    depositing: "存入中...",

    step1Hint: "先在本機裝置產生硬體 Passkey（TouchID / FaceID）並註冊公鑰上鏈，演練模式會自動確保金庫有餘額。",
    step1BtnWebAuthn: "綁定 TouchID / FaceID 並準備演練",
    step1BtnWebCrypto: "綁定 P-256 備援密鑰並準備演練",
    step1Busy: "正在註冊上鏈...",
    step1DepositHint: "硬體密鑰已綁定上鏈！目前金庫餘額不足 0.05 MON，請點擊下方按鈕存入 0.1 MON 以解鎖後續劫持與逃生演練。",
    step1DepositBtn: "存入 0.1 MON 並繼續演練",
    step1LowWalletHint: (bal) => `偵測到目前 MetaMask 餘額僅 ${bal} MON（需 ≥ 0.11 MON 支付存幣與 Gas），可直接切換免錢包模式零門檻體驗。`,
    switchToDemoBtn: "切換至「免錢包演練」繼續體驗",

    step2Hint: "點擊下方按鈕模擬真實 Name.com DNS 劫持：頁面外觀完全不變，但提款目標將被暗中竄改為駭客地址。",
    step2Btn: "模擬 Name.com DNS 劫持攻擊",
    step2Busy: "哨兵正在偵測並觸發亞秒熔斷...",

    hijackBannerTitle: "前端已被暗中劫持（上帝視角）",
    hijackBannerDesc: "提款按鈕底層收款人已被替換為駭客地址 0xdead...bad1",

    step3Hint: "ZeroDrain 哨兵已比對託管 JS 並將合約降級為 PASSKEY_ONLY 模式。點擊提款，驗證惡意提款會在預檢模擬階段即遭鏈上合約 Revert 拒絕！",
    step3Btn: "點擊被劫持的「提款 0.05 MON」",
    step3Busy: "送往 Monad 測試網驗證攔截...",

    blockedTitle: "惡意提款預檢模擬已遭合約拒絕（未浪費 Gas 上鏈）",
    blockedSub: "已預綁且持有有效 Passkey 的存戶資金不被凍結，可透過下方硬體逃生艙取回。",
    blockedRevertLabel: "預檢模擬 Revert",
    blockedTargetLabel: "遭阻斷的駭客地址",
    blockedLossValue: "模擬結果: 0 MON 轉出",

    step4Hint: "合約層強制鎖死只向本人地址（或 NORMAL 期預綁定的冷錢包）放款——前端根本無法傳入任意收款人，徹底化解簽署前 WYSIWYS 竄改！",
    step4NeedBindHint: "🔒 安全機制生效：熔斷期間合約已徹底凍結 Passkey 更換（防止被劫持前端誘騙覆寫密鑰）。點擊下方重置後即可綁定本機密鑰開始演練。",
    step4BtnWebAuthn: "按 TouchID / FaceID 經 0x0100 安全取回",
    step4BtnWebCrypto: "用 P-256 經 0x0100 預編譯安全取回",
    step4Busy: "等待硬體簽名與 0x0100 鏈上驗簽...",
    switchToFallback: "無指紋/面容？切換 WebCrypto P-256 備援",
    switchToBiometric: "切換回真實 TouchID / FaceID 模式",
    safeRecipientLocked: "鎖定收款地址",

    recoveredTitle: "0x0100 原生預編譯驗簽通過！資金已安全取回",
    recoveredSub: "完整攻防閉環已即時驗證於 Monad Testnet (#10143)。",
    replayBtn: "重置並再演練一次",
    viewTx: "查看鏈上交易",

    proofTitle: "即時鏈上防禦證據",
    proofSub: "所有偵測、熔斷與 0x0100 驗簽皆即時運行於 Monad 測試網",
    rowSriTitle: "前端 SRI 完整性指紋",
    rowSriOk: "指紋一致（clean.js）",
    rowSriDrift: "雜湊漂移！偵測到惡意注入腳本",
    rowTraceTitle: "交易前追蹤（debug_traceCall）",
    rowTraceOk: "收款人正常（指向用戶本人）",
    rowTraceHijacked: "收款人遭竄改 -> 0xdead...bad1",
    rowBreakerTitle: "鏈上熔斷（Sync RPC 廣播至收執）",
    rowBreakerStandby: "待機監控中（未觸發，暫無實測耗時）",
    rowBreakerTripped: "已生效 PASSKEY_ONLY",
    rowPrecompileTitle: "EIP-7951 (0x0100) 預編譯",
    rowPrecompileActive: "鏈上原生啟用 · 單次驗簽 6,900 gas",
    rpcUnavailable: "RPC 暫無法確認",
    viewVerifiedRecoveries: (n) => `查看鏈上已驗證逃生紀錄（累計 ${n} 筆）`,
    verifyGasLabel: "0x0100 單次驗簽 6,900 gas",

    metricTrips: "累計熔斷",
    metricRecoveries: "0x0100 逃生",
    metricGas: "目前 Gas",

    auditTitle: "最近鏈上紀錄",
    auditEmpty: "依照左側引導完成第 1 步，即時 Monad 測試網交易雜湊將出現於此。",

    detailsToggle: "評委參考：架構邊界、Monad 特性與商業模型",
    whyMonadTitle: "為何必須建在 Monad？",
    whyMonadBody: "依託 MIP-12 300ms 出塊 / 600ms 最終確定性與 eth_sendRawTransactionSync，哨兵比對託管 JS 異常後可在亞秒級（廣播至收執實測）完成鏈上熔斷，並呼叫原生 0x0100 預編譯以單次驗簽 6,900 gas 驗證 TouchID / FaceID。",
    boundaryTitle: "兩層防禦邊界（已綁 Passkey 零凍結）",
    boundaryBody: "① 協議層（本機實測）：降級為 PASSKEY_ONLY，已預綁有效 Passkey 的存戶可隨時逃生取回；② 錢包層延伸：同套 0x0100 模組可掛載為 EIP-7702 Guard Hook 攔截惡意 ERC-20 approve。",
    businessTitle: "可持續商業模型",
    businessBody: "B2B DeFi 安全護盾月度訂閱（按 TVL 分層）+ 去中心化白帽哨兵質押搶單分潤 + 鏈上保險保費折扣合作。",

    toastDepositOk: (ms) => `成功存入 0.10 MON（確認耗時 ${ms} ms）`,
    toastBindOk: (ms) => `硬體公鑰已上鏈註冊（耗時 ${ms} ms），請點擊第 2 步發起劫持演練！`,
    toastBindNeedDeposit: (ms) => `硬體公鑰已註冊（耗時 ${ms} ms）！請點擊下方按鈕存入 0.1 MON 完成金庫準備。`,
    toastTrippedOk: (ms) => `偵測到 DNS 劫持！哨兵已於 ${ms} ms 在鏈上觸發熔斷，請點擊提款測試攔截！`,
    toastAlreadyTripped: "合約已處於 PASSKEY_ONLY 保護中，可直接點擊提款測試攔截！",
    toastBlockedOk: "攔截成功！惡意的 Drainer 提款已遭鏈上 Revert，請用硬體逃生取回資金。",
    toastRecoveredOk: (ms) => `0x0100 預編譯驗簽成功！0.05 MON 已安全退回本機地址（${ms} ms）`,
    toastResetOk: (ms) => `已重置為 NORMAL 安全狀態（${ms} ms），隨時可重新演練。`,
    toastNoMetaMask: "未偵測到瀏覽器錢包插件，請直接使用「免錢包演練」模式體驗真實上鏈。",
    toastMetaMaskConnected: (addr) => `已連接 MetaMask (${addr}) 至 Monad Testnet`,
    toastNeedBind: "請先完成第 1 步綁定硬體密鑰。",
    toastBindHintFallback: "若目前裝置不支援生物辨識，可點擊下方切換為「WebCrypto P-256 備援模式」。",

    logDeposit: "存入 0.10 MON 至金庫",
    logBindWebAuthn: "鏈上綁定 TouchID / FaceID 公鑰",
    logBindWebCrypto: "鏈上綁定 WebCrypto P-256 公鑰",
    logTripped: (ms) => `偵測到 DNS 劫持 · ${ms} ms 鏈上熔斷`,
    logBlocked: "Drainer 提款遭合約 Revert 攔截（損失 0 MON）",
    logNormalWithdraw: "正常模式提款 0.05 MON 成功",
    logEscapedWebAuthn: "TouchID / FaceID 經 0x0100 驗簽取回 0.05 MON",
    logEscapedWebCrypto: "WebCrypto P-256 經 0x0100 驗簽取回 0.05 MON",
    logReset: "DNS 已清理 · 重置為 NORMAL 模式",
  },

  en: {
    brandName: "ZeroDrain",
    tagline: "Sub-Second Anti-Hijack Circuit Breaker & EIP-7951 Passkey Firewall on Monad",
    chainBadge: "Monad Testnet #10143",
    modeNormal: "NORMAL",
    modeTripped: "PASSKEY ONLY",
    demoWallet: "Instant Demo",
    metamaskWallet: "MetaMask",
    resetBtn: "Reset",
    resettingBtn: "Resetting",
    explorerBtn: "Verified Contract",

    steps: ["1. Bind Passkey", "2. DNS Hijack", "3. Block Drainer", "4. Hardware Escape"],

    vaultLabel: "Protected DeFi Frontend",
    vaultTitle: "Monad Staking Vault",
    vaultBalance: "Vault Balance",
    passkeyStatus: "Hardware Key",
    passkeyBound: "Bound",
    passkeyOutdated: "Re-bind needed",
    passkeyUnbound: "Not bound",
    depositQuick: "+ Deposit 0.1 MON",
    depositing: "Depositing...",

    step1Hint: "Register a hardware Passkey (TouchID / FaceID) on-chain. Instant Demo auto-funds the vault if empty.",
    step1BtnWebAuthn: "Bind TouchID / FaceID & Prepare Demo",
    step1BtnWebCrypto: "Bind WebCrypto P-256 & Prepare Demo",
    step1Busy: "Registering on Monad...",
    step1DepositHint: "Hardware key is bound! Your vault balance is below 0.05 MON—click below to deposit 0.1 MON from your wallet and unlock Step 2.",
    step1DepositBtn: "Deposit 0.1 MON & Continue",
    step1LowWalletHint: (bal) => `MetaMask balance is ${bal} MON (needs ≥ 0.11 MON for deposit + gas). You can switch to Instant Demo anytime with zero wallet balance required.`,
    switchToDemoBtn: "Switch to Instant Demo (Zero Balance Needed)",

    step2Hint: "Simulate a real Name.com DNS hijack: the UI still looks legitimate, but Withdraw silently routes to an attacker.",
    step2Btn: "Simulate Name.com DNS Hijack",
    step2Busy: "Sentinel tracing & tripping breaker...",

    hijackBannerTitle: "Frontend Silently Hijacked (Demo X-Ray)",
    hijackBannerDesc: "Withdraw recipient swapped to attacker 0xdead...bad1",

    step3Hint: "ZeroDrain compared the served JS bundle and switched the vault to PASSKEY_ONLY. Click Withdraw to confirm the drainer call reverts in preflight simulation.",
    step3Btn: "Try Hijacked Withdraw (0.05 MON)",
    step3Busy: "Testing preflight revert...",

    blockedTitle: "Hijacked Withdraw Rejected in Preflight Simulation",
    blockedSub: "Depositors with a pre-bound valid Passkey keep full withdrawal access via the hardware escape hatch below.",
    blockedRevertLabel: "Preflight Revert",
    blockedTargetLabel: "Blocked Attacker",
    blockedLossValue: "Simulated Loss: 0 MON",

    step4Hint: "Payout is enforced on-chain strictly to msg.sender (or a pre-bound cold recovery wallet)—even a compromised UI cannot inject an attacker recipient before signing!",
    step4NeedBindHint: "🔒 Security Invariant Active: Passkey mutation is strictly frozen on-chain during PASSKEY_ONLY incidents (prevents hijack key-overwrite). Click Reset to bind your own device key cleanly.",
    step4BtnWebAuthn: "Recover 0.05 MON via TouchID / 0x0100",
    step4BtnWebCrypto: "Recover 0.05 MON via P-256 / 0x0100",
    step4Busy: "Verifying via Monad 0x0100...",
    switchToFallback: "No biometrics? Use WebCrypto P-256 fallback",
    switchToBiometric: "Switch back to TouchID / FaceID",
    safeRecipientLocked: "Locked Safe Recipient",

    recoveredTitle: "Verified on Monad 0x0100! Funds Safely Recovered",
    recoveredSub: "Full attack-to-recovery lifecycle verified live on Monad Testnet (#10143).",
    replayBtn: "Reset & Replay Demo",
    viewTx: "View Tx",

    proofTitle: "Live On-Chain Proof",
    proofSub: "Every check, circuit break, and 0x0100 verification runs live on Monad Testnet",
    rowSriTitle: "Frontend SRI Fingerprint",
    rowSriOk: "Match (clean.js)",
    rowSriDrift: "SRI Hash Drift! Injected script detected",
    rowTraceTitle: "Pre-Tx Trace (debug_traceCall)",
    rowTraceOk: "Recipient clean (points to user)",
    rowTraceHijacked: "Recipient tampered -> 0xdead...bad1",
    rowBreakerTitle: "On-Chain Breaker (Broadcast → Receipt)",
    rowBreakerStandby: "Armed & Watching (not yet measured)",
    rowBreakerTripped: "PASSKEY_ONLY Active",
    rowPrecompileTitle: "EIP-7951 (0x0100) Precompile",
    rowPrecompileActive: "Native Active · 6,900 gas per verify",
    rpcUnavailable: "RPC unavailable / unconfirmed",
    viewVerifiedRecoveries: (n) => `Inspect ${n} Verified On-Chain Recoveries`,
    verifyGasLabel: "0x0100 verify: 6,900 gas",

    metricTrips: "Trips",
    metricRecoveries: "0x0100 Escapes",
    metricGas: "Live Gas",

    auditTitle: "Live Audit Trail",
    auditEmpty: "Complete Step 1 on the left to stream live Monad Testnet transaction hashes here.",

    detailsToggle: "For Judges: Why Monad, Defense Boundary & Business Model",
    whyMonadTitle: "Why Only Monad?",
    whyMonadBody: "Uses MIP-12 300ms blocks / 600ms finality + eth_sendRawTransactionSync to submit on-chain circuit breaks after detecting served JS drift (measured broadcast-to-receipt), plus native 0x0100 (EIP-7951) at 6,900 gas per verification.",
    boundaryTitle: "Two-Layer Defense (Passkey-Bound Recovery)",
    boundaryBody: "1) Protocol Vault Guard (Live): degrades to PASSKEY_ONLY so depositors holding a pre-bound valid Passkey can still withdraw during an incident. 2) Wallet Extension: same 0x0100 module plugs into EIP-7702 Guard Hooks for ERC-20 approvals.",
    businessTitle: "Business Model",
    businessBody: "TVL-tiered B2B security SaaS subscription + bonded sentinel alert bounties + DeFi insurance premium discounts.",

    toastDepositOk: (ms) => `Deposited 0.10 MON on Monad (${ms} ms)`,
    toastBindOk: (ms) => `Hardware public key registered on-chain (${ms} ms). Ready for Step 2!`,
    toastBindNeedDeposit: (ms) => `Hardware public key registered (${ms} ms)! Next, click below to deposit 0.1 MON into the vault.`,
    toastTrippedOk: (ms) => `DNS hijack caught! Vault switched to PASSKEY_ONLY in ${ms} ms.`,
    toastAlreadyTripped: "Vault is already in PASSKEY_ONLY mode—click Withdraw to verify the revert!",
    toastBlockedOk: "Drainer tx reverted on-chain (0 MON lost). Use Hardware Escape to recover.",
    toastRecoveredOk: (ms) => `Verified by Monad 0x0100! Recovered 0.05 MON safely (${ms} ms).`,
    toastResetOk: (ms) => `Vault restored to NORMAL (${ms} ms). Ready to replay.`,
    toastNoMetaMask: "No browser wallet found—use Instant Demo mode to test live on Monad Testnet.",
    toastMetaMaskConnected: (addr) => `Connected MetaMask (${addr}) on Monad Testnet`,
    toastNeedBind: "Please complete Step 1 to bind your hardware key first.",
    toastBindHintFallback: "If biometrics are unavailable here, switch to WebCrypto P-256 fallback below.",

    logDeposit: "Deposited 0.10 MON into Vault",
    logBindWebAuthn: "Registered TouchID / FaceID Public Key",
    logBindWebCrypto: "Registered WebCrypto P-256 Public Key",
    logTripped: (ms) => `DNS Hijack Caught · Tripped in ${ms} ms`,
    logBlocked: "Drainer Withdraw Reverted On-Chain (0 MON lost)",
    logNormalWithdraw: "Normal Withdraw 0.05 MON Succeeded",
    logEscapedWebAuthn: "TouchID / FaceID Verified via 0x0100 (0.05 MON)",
    logEscapedWebCrypto: "WebCrypto P-256 Verified via 0x0100 (0.05 MON)",
    logReset: "DNS Cleaned · Restored NORMAL Mode",
  },
};

export function detectInitialLocale(): Locale {
  if (typeof window === "undefined") return "zh-CN";
  const saved = localStorage.getItem("zerodrain_locale") as Locale | null;
  if (saved && saved in DICTIONARIES) return saved;
  const lang = (navigator.language || "").toLowerCase();
  if (lang.startsWith("zh-tw") || lang.startsWith("zh-hk") || lang.startsWith("zh-hant")) {
    return "zh-TW";
  }
  if (lang.startsWith("zh")) return "zh-CN";
  return "en";
}
