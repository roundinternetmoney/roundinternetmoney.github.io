import { ethers } from "ethers";
import {
  CHAINLIST_RPCS_URL,
  EMPTY_LIMIT_ORDER,
  ERC20_ABI,
  MARKET_ABI,
  MULTICALL3_ABI,
  PENDLE_CHAIN_CONFIGS,
  PENDLE_ROUTER_ABI,
  PENDLE_ROUTER_V4,
  SY_ABI,
  ZERO_SWAP_DATA
} from "./config";
import type {
  AppState,
  CachedMarketResolution,
  CachedTokenMetadata,
  Elements,
  PendleCatalog,
  PendleChainConfig,
  PendleMarketRecord,
  PendleMarketView,
  QueuedRouterCall,
  TokenOption
} from "./types";

const state: AppState = {
  browserProvider: null,
  signer: null,
  account: null,
  selectedChainKey: PENDLE_CHAIN_CONFIGS[0]?.key ?? "ethereum",
  readProvider: null,
  chainlistLoaded: false,
  rpcCatalog: {},
  marketResolutionCache: {},
  tokenMetadataCache: {},
  routerMulticallSupport: {},
  pendleMarkets: [],
  renderedMarkets: [],
  loading: {
    active: false,
    label: "Idle",
    current: 0,
    total: 1
  },
  queuedRouterCalls: []
};

const READ_RPC_TIMEOUT_MS = 3000;
const WALLET_CALLS_STATUS_PENDING = 100;
const WALLET_CALLS_STATUS_CONFIRMED = 200;
const WALLET_CALLS_STATUS_OFFCHAIN_FAILED = 400;
const WALLET_CALLS_STATUS_CHAIN_FAILED = 500;
const WALLET_CALLS_STATUS_PARTIAL_FAILED = 600;
const PT_SYMBOL_DATE_SUFFIX = /-(\d{1,2}[A-Z]{3}\d{4})$/;
const DIRECT_CALL_BATCH_LIMITS: Record<string, number> = {
  hyperliquid: 20
};

type WalletBatchCall = {
  to: string;
  data: string;
  value?: string;
};

function getElements(): Elements {
  const byId = <T extends HTMLElement>(id: string): T => {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Missing element #${id}`);
    }
    return element as T;
  };

  return {
    chainSelect: byId<HTMLSelectElement>("chainSelect"),
    connectButton: byId<HTMLButtonElement>("connectButton"),
    refreshButton: byId<HTMLButtonElement>("refreshButton"),
    activeMarketsOnlyToggle: byId<HTMLInputElement>("activeMarketsOnlyToggle"),
    loadingPanel: byId("loadingPanel"),
    loadingSpinner: byId("loadingSpinner"),
    loadingLabel: byId("loadingLabel"),
    loadingProgressBar: byId("loadingProgressBar"),
    loadingProgressText: byId("loadingProgressText"),
    debugToggle: byId<HTMLInputElement>("debugToggle"),
    debugPanel: byId("debugPanel"),
    batchWalletRequestsToggle: byId<HTMLInputElement>("batchWalletRequestsToggle"),
    sweepButton: byId<HTMLButtonElement>("sweepButton"),
    queuedCallsPanel: byId("queuedCallsPanel"),
    queuedCallsList: byId("queuedCallsList"),
    queueSubmitButton: byId<HTMLButtonElement>("queueSubmitButton"),
    queueClearButton: byId<HTMLButtonElement>("queueClearButton"),
    accountStatus: byId("accountStatus"),
    walletChainStatus: byId("walletChainStatus"),
    selectedChainStatus: byId("selectedChainStatus"),
    marketCountStatus: byId<HTMLInputElement>("marketCountStatus"),
    notice: byId("notice"),
    summary: byId("summary"),
    marketList: byId("marketList")
  };
}

const elements = getElements();

function getSelectedChain(): PendleChainConfig {
  const chain = PENDLE_CHAIN_CONFIGS.find((item) => item.key === state.selectedChainKey);
  if (!chain) {
    throw new Error(`Unsupported chain ${state.selectedChainKey}`);
  }
  return chain;
}

function getMarketCacheKey(chainKey: string, marketAddress: string): string {
  return `${chainKey}:${marketAddress.toLowerCase()}`;
}

function getTokenCacheKey(chainKey: string, tokenAddress: string): string {
  return `${chainKey}:${tokenAddress.toLowerCase()}`;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inferIsExpiredFromPtSymbol(symbol: string | null | undefined): boolean {
  if (!symbol) {
    return false;
  }

  const match = symbol.trim().toUpperCase().match(PT_SYMBOL_DATE_SUFFIX);
  if (!match) {
    return false;
  }

  const raw = match[1];
  const day = Number(raw.slice(0, -7));
  const monthCode = raw.slice(-7, -4);
  const year = Number(raw.slice(-4));
  const monthIndex = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].indexOf(monthCode);
  if (!day || monthIndex < 0 || !year) {
    return false;
  }

  const expiryUtc = Date.UTC(year, monthIndex, day, 23, 59, 59, 999);
  return Date.now() > expiryUtc;
}

function hasDecodableReturnData(result: { success: boolean; returnData: string } | undefined): result is { success: true; returnData: string } {
  return Boolean(result?.success && result.returnData && result.returnData !== "0x");
}

function decodeSingleResult<T>(iface: ethers.Interface, fragment: string, result: { success: boolean; returnData: string } | undefined): T | null {
  if (!hasDecodableReturnData(result)) {
    return null;
  }

  try {
    const decoded = iface.decodeFunctionResult(fragment, result.returnData) as unknown as [T];
    const [value] = decoded;
    return value;
  } catch {
    return null;
  }
}

function decodeTupleResult<T extends unknown[]>(iface: ethers.Interface, fragment: string, result: { success: boolean; returnData: string } | undefined): T | null {
  if (!hasDecodableReturnData(result)) {
    return null;
  }

  try {
    return iface.decodeFunctionResult(fragment, result.returnData) as unknown as T;
  } catch {
    return null;
  }
}

function setNotice(message: string, kind?: "error" | "good"): void {
  elements.notice.textContent = message;
  elements.notice.className = kind ? `notice ${kind}` : "notice";
}

function renderLoadingState(): void {
  elements.loadingPanel.classList.toggle("hidden", !state.loading.active);
  elements.loadingLabel.textContent = state.loading.label;
  const safeTotal = Math.max(1, state.loading.total);
  const percent = Math.max(0, Math.min(100, Math.round((state.loading.current / safeTotal) * 100)));
  elements.loadingProgressBar.style.width = `${percent}%`;
  elements.loadingProgressText.textContent = `${percent}%`;
  elements.connectButton.disabled = state.loading.active;
  elements.refreshButton.disabled = state.loading.active;
  elements.chainSelect.disabled = state.loading.active;
}

function startLoading(total: number, label: string): void {
  state.loading.active = true;
  state.loading.total = Math.max(1, total);
  state.loading.current = 0;
  state.loading.label = label;
  renderLoadingState();
}

function advanceLoading(label: string, step = 1): void {
  state.loading.label = label;
  state.loading.current = Math.min(state.loading.total, state.loading.current + step);
  renderLoadingState();
}

function finishLoading(): void {
  state.loading.active = false;
  state.loading.label = "Idle";
  state.loading.current = state.loading.total;
  renderLoadingState();
}

function useBatchWalletRequests(): boolean {
  return Boolean(elements.batchWalletRequestsToggle.checked);
}

function useActiveMarketsOnly(): boolean {
  return Boolean(elements.activeMarketsOnlyToggle.checked);
}

function renderDebugPanel(): void {
  elements.debugPanel.classList.toggle("hidden", !elements.debugToggle.checked);
  const hasSweepableMarkets = state.renderedMarkets.some((view) => view.ptBalance > 0n || view.syBalance > 0n);
  elements.sweepButton.disabled = !state.account || !hasSweepableMarkets || !useBatchWalletRequests();
  renderQueuedCalls();
}

function renderQueuedCalls(): void {
  if (!state.queuedRouterCalls.length) {
    elements.queuedCallsPanel.textContent = "No queued router calls.";
    elements.queueSubmitButton.disabled = true;
    elements.queueClearButton.disabled = true;
    return;
  }

  elements.queuedCallsPanel.innerHTML = state.queuedRouterCalls
    .map((call, index) => `${index + 1}. ${escapeHtml(call.label)}`)
    .join("<br>");
  elements.queueSubmitButton.disabled = !state.account;
  elements.queueClearButton.disabled = false;
}

function upsertQueuedRouterCall(call: QueuedRouterCall): void {
  const existingIndex = state.queuedRouterCalls.findIndex((item) => item.id === call.id);
  if (existingIndex >= 0) {
    state.queuedRouterCalls[existingIndex] = call;
  } else {
    state.queuedRouterCalls.push(call);
  }
  renderQueuedCalls();
}

function clearQueuedRouterCalls(): void {
  state.queuedRouterCalls = [];
  renderQueuedCalls();
}

function populateChainSelect(): void {
  elements.chainSelect.innerHTML = "";
  for (const chain of PENDLE_CHAIN_CONFIGS) {
    const option = document.createElement("option");
    option.value = chain.key;
    option.textContent = chain.name;
    elements.chainSelect.appendChild(option);
  }
  elements.chainSelect.value = state.selectedChainKey;
}

async function loadPendleConfig(): Promise<void> {
  const response = await fetch("../src/pendle.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load Pendle config: ${response.status}`);
  }

  const payload = (await response.json()) as PendleCatalog;
  const supportedChainKeys = new Set(PENDLE_CHAIN_CONFIGS.map((chain) => chain.key));
  state.pendleMarkets = payload.markets
    .filter((market) => supportedChainKeys.has(market.chainKey))
    .map((market) => ({
      ...market,
      marketAddress: ethers.getAddress(market.marketAddress),
      ptAddress: market.ptAddress ? ethers.getAddress(market.ptAddress) : undefined,
      syAddress: market.syAddress ? ethers.getAddress(market.syAddress) : undefined,
      ytAddress: market.ytAddress ? ethers.getAddress(market.ytAddress) : undefined,
      assetTokenAddress: market.assetTokenAddress ? ethers.getAddress(market.assetTokenAddress) : undefined,
      redeemOptions: Array.isArray(market.redeemOptions)
        ? market.redeemOptions
            .filter((option) => option && ethers.isAddress(option.address))
            .map((option) => ({
              address: ethers.getAddress(option.address),
              symbol: option.symbol,
              decimals: option.decimals
            }))
        : []
    }))
    .sort((left, right) => left.marketAddress.localeCompare(right.marketAddress));
}

class ReadRpcTimeoutError extends Error {}

function createStaticJsonRpcProvider(url: string, chainId: number): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(url, chainId, { staticNetwork: true });
}

function destroyProvider(provider: ethers.JsonRpcProvider | null): void {
  if (!provider) {
    return;
  }
  provider.destroy();
  if (state.readProvider === provider) {
    state.readProvider = null;
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

function isLikelyKeyedRpcUrl(url: string): boolean {
  const value = url.toLowerCase();

  if (
    value.includes("<api-key>") ||
    value.includes("your_api_key") ||
    value.includes("your-api-key") ||
    value.includes("/v2/demo") ||
    value.includes("/v3/your-api-key")
  ) {
    return true;
  }

  return [
    "alchemy.com",
    "ankr.com",
    "api.securerpc.com",
    "bitstack.com",
    "builder0x69.io",
    "eth-mainnet-public.unifra.io",
    "flashbots.net",
    "infura.io",
    "payload.de",
    "quicknode.com",
    "chainstack.com",
    "tenderly.co",
    "getblock.io",
    "thirdweb.com",
    "blastapi.io"
  ].some((fragment) => value.includes(fragment));
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

    for (const chain of PENDLE_CHAIN_CONFIGS) {
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
    return state.rpcCatalog;
  }
}

function getRpcUrlsForChain(chain: PendleChainConfig): string[] {
  const dynamic = (state.rpcCatalog[chain.key] || []).slice(0, 4);
  const merged = [...(chain.rpcUrls || []), ...dynamic]
    .map(sanitizeRpcUrl)
    .filter((value): value is string => Boolean(value))
    .filter((value) => !isLikelyKeyedRpcUrl(value));
  return [...new Set(merged)];
}

async function withTimeout<T>(label: string, task: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new ReadRpcTimeoutError(label + " timed out after " + timeoutMs + "ms"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function withRetries<T>(label: string, task: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (error instanceof ReadRpcTimeoutError || attempt === maxRetries) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(250 * attempt, 1000)));
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(label + " failed after " + maxRetries + " attempts: " + message);
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
    state.readProvider = provider;
    try {
      const result = await withRetries(
        label + " via " + url,
        () => withTimeout(label + " via " + url, task(provider), READ_RPC_TIMEOUT_MS)
      );
      destroyProvider(provider);
      return result;
    } catch (error) {
      lastError = error;
      destroyProvider(provider);
    }
  }

  throw lastError || new Error(label + " failed across all RPC URLs");
}

async function aggregateCalls(
  provider: ethers.JsonRpcProvider,
  calls: Array<{ target: string; allowFailure?: boolean; callData: string }>
): Promise<Array<{ success: boolean; returnData: string }>> {
  const chain = getSelectedChain();
  const multicall = chain.multicall3;
  if (!multicall) {
    const fallbackResults: Array<{ success: boolean; returnData: string }> = [];
    const chunkSize = DIRECT_CALL_BATCH_LIMITS[chain.key] ?? 24;

    for (let index = 0; index < calls.length; index += chunkSize) {
      const chunk = calls.slice(index, index + chunkSize);
      const chunkResults = await Promise.all(
        chunk.map(async (call) => {
          try {
            const returnData = await provider.call({
              to: call.target,
              data: call.callData
            });
            return { success: true, returnData };
          } catch {
            return { success: false, returnData: "0x" };
          }
        })
      );
      fallbackResults.push(...chunkResults);
    }

    if (calls.length > 0 && !fallbackResults.some((item) => item.success && item.returnData && item.returnData !== "0x")) {
      throw new Error(`No decodable direct-call responses from ${chain.name}`);
    }

    return fallbackResults;
  }

  const contract = new ethers.Contract(multicall, MULTICALL3_ABI, provider);
  const results: Array<{ success: boolean; returnData: string }> = [];
  const chunkSize = 80;
  let successfulResponses = 0;

  const runChunk = async (
    chunk: Array<{ target: string; allowFailure?: boolean; callData: string }>
  ): Promise<Array<{ success: boolean; returnData: string }>> => {
    const normalized = chunk.map((call) => ({
      target: call.target,
      allowFailure: call.allowFailure ?? true,
      callData: call.callData
    }));

    try {
      const response = (await contract.aggregate3(normalized)) as Array<{ success: boolean; returnData: string }>;
      successfulResponses += response.filter((item) => item.success && item.returnData && item.returnData !== "0x").length;
      return response;
    } catch (error) {
      if (normalized.length === 1) {
        return [{ success: false, returnData: "0x" }];
      }

      const midpoint = Math.ceil(normalized.length / 2);
      const left = await runChunk(normalized.slice(0, midpoint));
      const right = await runChunk(normalized.slice(midpoint));
      return [...left, ...right];
    }
  };

  for (let index = 0; index < calls.length; index += chunkSize) {
    const chunk = calls.slice(index, index + chunkSize);
    const response = await runChunk(chunk);
    results.push(...response);
  }

  if (calls.length > 0 && successfulResponses === 0) {
    throw new Error(`No decodable multicall responses from ${chain.name}`);
  }

  return results;
}

function formatBalance(value: bigint, decimals: number): string {
  const formatted = ethers.formatUnits(value, decimals);
  if (!formatted.includes(".")) {
    return formatted;
  }
  return formatted.replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
}

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function createExplorerLink(chain: PendleChainConfig, address: string): string {
  return chain.blockExplorerUrl ? `${chain.blockExplorerUrl}/address/${address}` : address;
}

async function refreshWalletSession(): Promise<void> {
  if (!window.ethereum) {
    elements.accountStatus.textContent = "wallet not detected";
    elements.walletChainStatus.textContent = "-";
    return;
  }

  if (!state.browserProvider) {
    state.browserProvider = new ethers.BrowserProvider(window.ethereum);
  }

  const accounts = (await state.browserProvider.send("eth_accounts", [])) as string[];
  state.account = accounts[0] ? ethers.getAddress(accounts[0]) : null;
  state.signer = state.account ? await state.browserProvider.getSigner() : null;

  elements.accountStatus.textContent = state.account ?? "not connected";

  try {
    const network = await state.browserProvider.getNetwork();
    elements.walletChainStatus.textContent = `${network.name || "chain"} (${network.chainId})`;
  } catch {
    elements.walletChainStatus.textContent = "-";
  }
}

async function connectWallet(): Promise<void> {
  if (!window.ethereum) {
    throw new Error("No EVM wallet found in this browser");
  }
  state.browserProvider = new ethers.BrowserProvider(window.ethereum);
  await state.browserProvider.send("eth_requestAccounts", []);
  await refreshWalletSession();
}

async function switchWalletChain(): Promise<void> {
  if (!window.ethereum) {
    throw new Error("No EVM wallet found in this browser");
  }

  const chain = getSelectedChain();
  const hexChainId = `0x${chain.chainId.toString(16)}`;

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexChainId }]
    });
  } catch (error) {
    const switchError = error as { code?: number };
    if (switchError.code !== 4902) {
      throw error;
    }

    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hexChainId,
          chainName: chain.name,
          rpcUrls: chain.rpcUrls,
          blockExplorerUrls: chain.blockExplorerUrl ? [chain.blockExplorerUrl] : [],
          nativeCurrency: { name: chain.name, symbol: chain.key.toUpperCase(), decimals: 18 }
        }
      ]
    });
  }

  state.browserProvider = null;
  await refreshWalletSession();
}

async function loadMarketViews(): Promise<PendleMarketView[]> {
  const chain = getSelectedChain();
  const allChainMarketRecords = state.pendleMarkets.filter((item) => item.chainKey === chain.key);
  const resolvedChainMarketRecords = allChainMarketRecords.filter((record) => record.ptAddress && record.syAddress);
  elements.marketCountStatus.value = `${resolvedChainMarketRecords.length} resolved / ${allChainMarketRecords.length} total`;

  if (!state.account) {
    return [];
  }

  startLoading(6, `Refreshing ${chain.name} wallet view`);

  const erc20Interface = new ethers.Interface(ERC20_ABI);
  advanceLoading("Preparing resolved market list");
  for (const record of resolvedChainMarketRecords) {
    const cacheKey = getMarketCacheKey(chain.key, record.marketAddress);
    if (record.ptAddress && record.syAddress) {
      const prior = state.marketResolutionCache[cacheKey];
      state.marketResolutionCache[cacheKey] = {
        syAddress: ethers.getAddress(record.syAddress),
        ptAddress: ethers.getAddress(record.ptAddress),
        ytAddress: record.ytAddress ? ethers.getAddress(record.ytAddress) : ethers.ZeroAddress,
        isExpired: inferIsExpiredFromPtSymbol(record.ptSymbol) || prior?.isExpired || false
      };
    }

    if (record.ptAddress && record.ptSymbol && record.decimalsPT !== null) {
      state.tokenMetadataCache[getTokenCacheKey(chain.key, record.ptAddress)] = {
        symbol: record.ptSymbol,
        decimals: record.decimalsPT,
        outputs: [],
        assetTokenAddress: null,
        assetTokenDecimals: null
      };
    }

    if (record.syAddress && record.sySymbol && record.decimalsSY !== null) {
      const existing = state.tokenMetadataCache[getTokenCacheKey(chain.key, record.syAddress)];
      state.tokenMetadataCache[getTokenCacheKey(chain.key, record.syAddress)] = {
        symbol: record.sySymbol,
        decimals: record.decimalsSY,
        outputs: Array.isArray(record.redeemOptions) ? record.redeemOptions.map((option) => option.address) : (existing?.outputs ?? []),
        assetTokenAddress: record.assetTokenAddress ?? existing?.assetTokenAddress ?? null,
        assetTokenDecimals: record.assetTokenDecimals ?? existing?.assetTokenDecimals ?? null
      };
    }
  }

  const marketRecords = resolvedChainMarketRecords.filter((record) => {
    if (!useActiveMarketsOnly()) {
      return true;
    }
    const cachedResolution = state.marketResolutionCache[getMarketCacheKey(chain.key, record.marketAddress)];
    return cachedResolution ? !cachedResolution.isExpired : true;
  });
  elements.marketCountStatus.value = useActiveMarketsOnly()
    ? `${marketRecords.length} active / ${resolvedChainMarketRecords.length} resolved`
    : `${marketRecords.length} resolved / ${allChainMarketRecords.length} total`;

  const tokenEntries: Array<{ key: string; tokenAddress: string; type: "pt" | "sy"; marketAddress: string }> = [];
  const marketTokenData = new Map<string, CachedMarketResolution>();
  for (const record of marketRecords) {
    const cachedResolution = state.marketResolutionCache[getMarketCacheKey(chain.key, record.marketAddress)];
    if (!cachedResolution) {
      continue;
    }
    marketTokenData.set(record.marketAddress, cachedResolution);
    tokenEntries.push(
      { key: `${record.marketAddress}:pt`, tokenAddress: cachedResolution.ptAddress, type: "pt", marketAddress: record.marketAddress },
      { key: `${record.marketAddress}:sy`, tokenAddress: cachedResolution.syAddress, type: "sy", marketAddress: record.marketAddress }
    );
  }

  const missingTokenEntries = tokenEntries.filter((entry) => !state.tokenMetadataCache[getTokenCacheKey(chain.key, entry.tokenAddress)]);
  advanceLoading(
    useActiveMarketsOnly()
      ? "Loading missing PT and SY token metadata for active markets"
      : "Loading missing PT and SY token metadata"
  );
  if (missingTokenEntries.length) {
    await withRotatingProvider("load Pendle token metadata", async (provider) => {
      const tokenCalls = missingTokenEntries.flatMap((entry) => [
        { target: entry.tokenAddress, callData: erc20Interface.encodeFunctionData("symbol") },
        { target: entry.tokenAddress, callData: erc20Interface.encodeFunctionData("decimals") }
      ]);
      const tokenResults = await aggregateCalls(provider, tokenCalls);

      let cursor = 0;
      for (const entry of missingTokenEntries) {
        const symbolResult = tokenResults[cursor++];
        const decimalsResult = tokenResults[cursor++];
        if (!symbolResult?.success || !decimalsResult?.success) {
          continue;
        }

        const symbol = decodeSingleResult<string>(erc20Interface, "symbol", symbolResult);
        const decimals = decodeSingleResult<bigint>(erc20Interface, "decimals", decimalsResult);
        if (!symbol || decimals === null) {
          continue;
        }
        const metadata: CachedTokenMetadata = {
          symbol,
          decimals: Number(decimals),
          outputs: [],
          assetTokenAddress: null,
          assetTokenDecimals: null
        };

        state.tokenMetadataCache[getTokenCacheKey(chain.key, entry.tokenAddress)] = metadata;
      }
      return true;
    });
  }

  const balancesByKey = new Map<string, bigint>();
  advanceLoading(
    tokenEntries.length
      ? useActiveMarketsOnly()
        ? "Scanning PT and SY balances on active markets"
        : "Scanning PT and SY balances"
      : "No PT or SY balances to scan"
  );
  if (tokenEntries.length) {
    await withRotatingProvider("load Pendle balances", async (provider) => {
      const balanceCalls = tokenEntries.map((entry) => ({
        target: entry.tokenAddress,
        callData: erc20Interface.encodeFunctionData("balanceOf", [state.account])
      }));
      const balanceResults = await aggregateCalls(provider, balanceCalls);
      for (let index = 0; index < tokenEntries.length; index += 1) {
        const result = balanceResults[index];
        if (!result?.success) {
          continue;
        }
        const balance = decodeSingleResult<bigint>(erc20Interface, "balanceOf", result);
        if (balance !== null) {
          balancesByKey.set(tokenEntries[index].key, balance);
        }
      }
      return true;
    });
  }

  advanceLoading("Building balance view");

  const views: PendleMarketView[] = [];
  for (const record of marketRecords) {
    const tokenData = marketTokenData.get(record.marketAddress);
    if (!tokenData) {
      continue;
    }

    const ptMetadata = state.tokenMetadataCache[getTokenCacheKey(chain.key, tokenData.ptAddress)];
    const syMetadata = state.tokenMetadataCache[getTokenCacheKey(chain.key, tokenData.syAddress)];
    if (!ptMetadata || !syMetadata) {
      continue;
    }

    views.push({
      chainKey: record.chainKey,
      chainName: record.chainName,
      marketAddress: record.marketAddress,
      underlyingLabel: record.underlyingLabel,
      ptAddress: tokenData.ptAddress,
      ptSymbol: ptMetadata.symbol,
      ptDecimals: ptMetadata.decimals,
      ptBalance: balancesByKey.get(`${record.marketAddress}:pt`) ?? 0n,
      syAddress: tokenData.syAddress,
      sySymbol: syMetadata.symbol,
      syDecimals: syMetadata.decimals,
      syBalance: balancesByKey.get(`${record.marketAddress}:sy`) ?? 0n,
      ytAddress: tokenData.ytAddress,
      isExpired: tokenData.isExpired,
      outputTokens: Array.isArray(record.redeemOptions) && record.redeemOptions.length
        ? record.redeemOptions
        : syMetadata.assetTokenAddress
          ? [{
              address: syMetadata.assetTokenAddress,
              symbol: `Asset ${formatAddress(syMetadata.assetTokenAddress)}`,
              decimals: syMetadata.assetTokenDecimals ?? syMetadata.decimals
            }]
          : [],
      assetTokenAddress: syMetadata.assetTokenAddress
    });
  }

  views.sort((left, right) => {
    const leftHasBalance = left.ptBalance > 0n || left.syBalance > 0n;
    const rightHasBalance = right.ptBalance > 0n || right.syBalance > 0n;
    if (leftHasBalance !== rightHasBalance) {
      return leftHasBalance ? -1 : 1;
    }
    return left.marketAddress.localeCompare(right.marketAddress);
  });

  advanceLoading(
    useActiveMarketsOnly()
      ? `Prepared ${views.length} active market cards`
      : `Prepared ${views.length} market cards`
  );
  advanceLoading("Rendering market cards");
  return views;
}

function chooseDefaultOutputToken(view: PendleMarketView): TokenOption | null {
  if (view.assetTokenAddress) {
    const exact = view.outputTokens.find((token) => token.address === view.assetTokenAddress);
    if (exact) {
      return exact;
    }
  }
  return view.outputTokens[0] ?? null;
}

async function ensureSyAssetToken(view: PendleMarketView): Promise<TokenOption | null> {
  const existing = chooseDefaultOutputToken(view);
  if (existing) {
    return existing;
  }

  const syInterface = new ethers.Interface(SY_ABI);
  const chain = getSelectedChain();
  const metadata = state.tokenMetadataCache[getTokenCacheKey(chain.key, view.syAddress)];

  const assetInfo = await withRotatingProvider("load SY asset token", async (provider) => {
    const result = await aggregateCalls(provider, [
      { target: view.syAddress, callData: syInterface.encodeFunctionData("assetInfo") }
    ]);
    return decodeTupleResult<[bigint, string, bigint]>(syInterface, "assetInfo", result[0]);
  });

  if (!assetInfo) {
    return null;
  }

  const [, assetTokenAddress, assetTokenDecimals] = assetInfo;
  if (assetTokenAddress === ethers.ZeroAddress) {
    return null;
  }

  const normalizedAddress = ethers.getAddress(assetTokenAddress);
  state.tokenMetadataCache[getTokenCacheKey(chain.key, view.syAddress)] = {
    symbol: metadata?.symbol ?? view.sySymbol,
    decimals: metadata?.decimals ?? view.syDecimals,
    outputs: metadata?.outputs ?? [],
    assetTokenAddress: normalizedAddress,
    assetTokenDecimals: Number(assetTokenDecimals)
  };

  return {
    address: normalizedAddress,
    symbol: `Asset ${formatAddress(normalizedAddress)}`,
    decimals: Number(assetTokenDecimals)
  };
}

function renderSummary(): void {
  const total = state.renderedMarkets.length;
  const withBalances = state.renderedMarkets.filter((item) => item.ptBalance > 0n || item.syBalance > 0n).length;
  const withPt = state.renderedMarkets.filter((item) => item.ptBalance > 0n).length;
  const withSy = state.renderedMarkets.filter((item) => item.syBalance > 0n).length;

  elements.summary.innerHTML = `
    <div class="summary-grid">
      <div>configured markets</div><div>${total}</div>
      <div>markets with balances</div><div>${withBalances}</div>
      <div>PT balances</div><div>${withPt}</div>
      <div>SY balances</div><div>${withSy}</div>
    </div>
  `;
}

function renderMarkets(): void {
  const chain = getSelectedChain();

  if (!state.account) {
    elements.marketList.innerHTML = `<div class="panel"><p class="panel-intro">Connect a wallet to inspect Pendle PT and SY balances on ${chain.name}.</p></div>`;
    renderSummary();
    return;
  }

  if (state.renderedMarkets.length === 0) {
    elements.marketList.innerHTML = `<div class="panel"><p class="panel-intro">No Pendle markets were resolved for ${chain.name}.</p></div>`;
    renderSummary();
    return;
  }

  elements.marketList.innerHTML = state.renderedMarkets.map((view, index) => {
    const defaultOutput = chooseDefaultOutputToken(view);
    const chainLink = createExplorerLink(chain, view.marketAddress);
    const ptLink = createExplorerLink(chain, view.ptAddress);
    const syLink = createExplorerLink(chain, view.syAddress);
    const outputOptions = view.outputTokens
      .map((token) => {
        const selected = token.address === defaultOutput?.address ? " selected" : "";
        return `<option value="${token.address}"${selected}>${token.symbol} [${formatAddress(token.address)}]</option>`;
      })
      .join("") || `<option value="">Load asset token on submit</option>`;

    return `
      <article class="panel market-card" data-market-index="${index}">
        <div class="market-card-header">
          <div>
            <h2>${view.underlyingLabel} market</h2>
            <p class="panel-intro">Direct RouterV4 actions for this market. Market reads are resolved on-chain from the market address itself.</p>
          </div>
          <div class="market-meta">
            <div>${view.isExpired ? "expired" : "active"}</div>
            <div><a href="${chainLink}" target="_blank" rel="noreferrer">${formatAddress(view.marketAddress)}</a></div>
          </div>
        </div>
        <div class="market-columns">
          <div class="codebox">
            <strong>PT</strong><br>
            ${view.ptSymbol}: ${formatBalance(view.ptBalance, view.ptDecimals)}<br>
            <a href="${ptLink}" target="_blank" rel="noreferrer">${view.ptAddress}</a>
          </div>
          <div class="codebox">
            <strong>SY</strong><br>
            ${view.sySymbol}: ${formatBalance(view.syBalance, view.syDecimals)}<br>
            <a href="${syLink}" target="_blank" rel="noreferrer">${view.syAddress}</a>
          </div>
        </div>
        <div class="row">
          <label>
            PT amount to swap
            <input class="pt-amount" type="text" value="${view.ptBalance > 0n ? formatBalance(view.ptBalance, view.ptDecimals) : ""}" placeholder="0.0" />
            <span class="field-note">Calls router.swapExactPtForSy(receiver, market, exactPtIn, minSyOut, limit).</span>
          </label>
          <label>
            Min SY out
            <input class="pt-min-sy-out" type="text" value="0" />
            <span class="field-note">Zero means no slippage protection.</span>
          </label>
        </div>
        <div class="actions compact-actions">
          <button class="swap-pt-button" type="button"${view.ptBalance > 0n ? "" : " disabled"}>Swap PT -> SY</button>
          <button class="queue-pt-router-button" type="button"${view.ptBalance > 0n && view.isExpired ? "" : " disabled"}>Queue router PT -> SY</button>
        </div>
        <div class="row">
          <label>
            SY amount to redeem
            <input class="sy-amount" type="text" value="${view.syBalance > 0n ? formatBalance(view.syBalance, view.syDecimals) : ""}" placeholder="0.0" />
            <span class="field-note">Calls router.redeemSyToToken(receiver, SY, netSyIn, output).</span>
          </label>
          <label>
            Min token out
            <input class="sy-min-token-out" type="text" value="0" />
            <span class="field-note">Zero means no slippage protection.</span>
          </label>
        </div>
        <div class="row">
          <label>
            Redeem token
            <select class="redeem-token-select">${outputOptions}</select>
            <span class="field-note">Defaults to the SY asset token when it is also redeemable.</span>
          </label>
          <label>
            Result
            <input class="result-display" type="text" value="idle" readonly />
            <span class="field-note">Approvals are separate ERC-20 transactions.</span>
          </label>
        </div>
        <div class="actions compact-actions">
          <button class="redeem-sy-button" type="button"${view.syBalance > 0n ? "" : " disabled"}>Redeem SY -> token</button>
          <button class="queue-sy-router-button" type="button"${view.syBalance > 0n ? "" : " disabled"}>Queue router SY -> token</button>
        </div>
      </article>
    `;
  }).join("");

  renderSummary();
}

function parseAmount(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Amount is required");
  }
  return ethers.parseUnits(trimmed, decimals);
}

async function ensureApproval(tokenAddress: string, amount: bigint): Promise<void> {
  if (!state.signer || !state.account) {
    throw new Error("Wallet not connected");
  }

  const token = new ethers.Contract(tokenAddress, ERC20_ABI, state.signer);
  const allowance = (await token.allowance(state.account, PENDLE_ROUTER_V4)) as bigint;
  if (allowance >= amount) {
    return;
  }

  const approvalTx = await token.approve(PENDLE_ROUTER_V4, ethers.MaxUint256);
  await approvalTx.wait();
}

async function getApprovalCallIfNeeded(tokenAddress: string, amount: bigint): Promise<WalletBatchCall | null> {
  if (!state.signer || !state.account) {
    throw new Error("Wallet not connected");
  }

  const token = new ethers.Contract(tokenAddress, ERC20_ABI, state.signer);
  const allowance = (await token.allowance(state.account, PENDLE_ROUTER_V4)) as bigint;
  if (allowance >= amount) {
    return null;
  }

  return {
    to: tokenAddress,
    data: token.interface.encodeFunctionData("approve", [PENDLE_ROUTER_V4, ethers.MaxUint256])
  };
}

async function connectAndSwitchForAction(): Promise<void> {
  if (!state.account) {
    await connectWallet();
  } else {
    await refreshWalletSession();
  }
  await switchWalletChain();
}

function errorMessageIncludesInvalidSelector(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("INVALID_SELECTOR");
}

async function routerSupportsMulticall(router: ethers.Contract): Promise<boolean> {
  const chainKey = state.selectedChainKey;
  const cached = state.routerMulticallSupport[chainKey];
  if (typeof cached === "boolean") {
    return cached;
  }

  try {
    await router.multicall.staticCall([]);
    state.routerMulticallSupport[chainKey] = true;
    return true;
  } catch (error) {
    if (errorMessageIncludesInvalidSelector(error)) {
      state.routerMulticallSupport[chainKey] = false;
      return false;
    }

    state.routerMulticallSupport[chainKey] = true;
    return true;
  }
}

async function walletSupportsSendCalls(): Promise<boolean> {
  if (!window.ethereum || !state.account) {
    return false;
  }

  try {
    const chain = getSelectedChain();
    const chainIdHex = `0x${chain.chainId.toString(16)}`;
    const capabilities = await window.ethereum.request({
      method: "wallet_getCapabilities",
      params: [state.account, [chainIdHex]]
    }) as Record<string, Record<string, { supported?: boolean; status?: string }>>;

    const shared = capabilities["0x0"] ?? {};
    const specific = capabilities[chainIdHex] ?? {};
    const walletSendCalls = specific["wallet_sendCalls"] ?? shared["wallet_sendCalls"];
    return walletSendCalls?.supported === true || walletSendCalls?.status === "supported" || walletSendCalls?.status === "ready";
  } catch {
    return false;
  }
}

async function waitForWalletCalls(batchId: string): Promise<string[]> {
  if (!window.ethereum) {
    throw new Error("Wallet batch status is unavailable");
  }

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const status = await window.ethereum.request({
      method: "wallet_getCallsStatus",
      params: [batchId]
    }) as { status?: number; receipts?: Array<{ transactionHash?: string }> };

    const code = Number(status?.status ?? 0);
    if (code === WALLET_CALLS_STATUS_PENDING) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }

    if (code === WALLET_CALLS_STATUS_CONFIRMED || code === WALLET_CALLS_STATUS_PARTIAL_FAILED) {
      return (status.receipts ?? [])
        .map((receipt) => receipt.transactionHash)
        .filter((hash): hash is string => Boolean(hash));
    }

    if (code === WALLET_CALLS_STATUS_OFFCHAIN_FAILED || code === WALLET_CALLS_STATUS_CHAIN_FAILED) {
      throw new Error("Wallet batch execution failed");
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error("Wallet batch is still pending after 120s");
}

async function tryWalletBatchSweep(calls: WalletBatchCall[]): Promise<string[] | null> {
  if (!window.ethereum || !state.account || !calls.length) {
    return null;
  }

  if (!(await walletSupportsSendCalls())) {
    return null;
  }

  const chain = getSelectedChain();
  try {
    const result = await window.ethereum.request({
      method: "wallet_sendCalls",
      params: [{
        version: "2.0.0",
        from: state.account,
        chainId: `0x${chain.chainId.toString(16)}`,
        atomicRequired: false,
        calls
      }]
    }) as { id?: string };

    if (!result?.id) {
      throw new Error("Wallet batch request returned no id");
    }

    return await waitForWalletCalls(result.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("wallet_sendCalls") ||
      message.includes("wallet_getCallsStatus") ||
      message.includes("Unsupported") ||
      message.includes("not supported") ||
      message.includes("Method not found")
    ) {
      return null;
    }
    throw error;
  }
}

async function performPtSwap(view: PendleMarketView, card: HTMLElement): Promise<void> {
  const amountInput = card.querySelector<HTMLInputElement>(".pt-amount");
  const minSyInput = card.querySelector<HTMLInputElement>(".pt-min-sy-out");
  const resultDisplay = card.querySelector<HTMLInputElement>(".result-display");
  if (!amountInput || !minSyInput || !resultDisplay) {
    throw new Error("PT swap inputs are missing");
  }

  await connectAndSwitchForAction();
  const amount = parseAmount(amountInput.value, view.ptDecimals);
  const minSyOut = parseAmount(minSyInput.value || "0", view.syDecimals);
  if (!view.isExpired) {
    const pt = new ethers.Contract(view.ptAddress, ERC20_ABI, state.signer);
    const market = new ethers.Contract(view.marketAddress, MARKET_ABI, state.signer);
    resultDisplay.value = "sending PT to market";
    const transferTx = await pt.transfer(view.marketAddress, amount);
    await transferTx.wait();
    resultDisplay.value = "submitting market PT -> SY";
    const swapTx = await market.swapExactPtForSy(state.account, amount, "0x");
    resultDisplay.value = swapTx.hash;
    await swapTx.wait();
    resultDisplay.value = "PT -> SY confirmed";
    return;
  }

  await ensureApproval(view.ptAddress, amount);
  const router = new ethers.Contract(PENDLE_ROUTER_V4, PENDLE_ROUTER_ABI, state.signer);
  resultDisplay.value = "submitting post-expiry PT -> SY";
  const exitTx = await router.exitPostExpToSy(state.account, view.marketAddress, amount, 0n, minSyOut);
  resultDisplay.value = exitTx.hash;
  await exitTx.wait();
  resultDisplay.value = "Post-expiry PT -> SY confirmed";
}

async function performSyRedeem(view: PendleMarketView, card: HTMLElement): Promise<void> {
  const amountInput = card.querySelector<HTMLInputElement>(".sy-amount");
  const minTokenInput = card.querySelector<HTMLInputElement>(".sy-min-token-out");
  const redeemTokenSelect = card.querySelector<HTMLSelectElement>(".redeem-token-select");
  const resultDisplay = card.querySelector<HTMLInputElement>(".result-display");
  if (!amountInput || !minTokenInput || !redeemTokenSelect || !resultDisplay) {
    throw new Error("SY redeem inputs are missing");
  }

  const selectedOutput = view.outputTokens.find((token) => token.address === redeemTokenSelect.value)
    ?? await ensureSyAssetToken(view);
  if (!selectedOutput) {
    throw new Error("Choose a redeem token first");
  }

  await connectAndSwitchForAction();
  const amount = parseAmount(amountInput.value, view.syDecimals);
  const minTokenOut = parseAmount(minTokenInput.value || "0", selectedOutput.decimals);
  await ensureApproval(view.syAddress, amount);

  const router = new ethers.Contract(PENDLE_ROUTER_V4, PENDLE_ROUTER_ABI, state.signer);
  const output = {
    tokenOut: selectedOutput.address,
    minTokenOut,
    tokenRedeemSy: selectedOutput.address,
    pendleSwap: ethers.ZeroAddress,
    swapData: ZERO_SWAP_DATA
  };

  resultDisplay.value = "submitting SY redeem";
  const tx = await router.redeemSyToToken(state.account, view.syAddress, amount, output);
  resultDisplay.value = tx.hash;
  await tx.wait();
  resultDisplay.value = "SY redeem confirmed";
}

async function buildQueuedPtRouterCall(view: PendleMarketView, card: HTMLElement): Promise<QueuedRouterCall> {
  if (!view.isExpired) {
    throw new Error("Only expired PT positions can be queued for router multicall");
  }

  const amountInput = card.querySelector<HTMLInputElement>(".pt-amount");
  const minSyInput = card.querySelector<HTMLInputElement>(".pt-min-sy-out");
  if (!amountInput || !minSyInput) {
    throw new Error("PT queue inputs are missing");
  }

  const amount = parseAmount(amountInput.value, view.ptDecimals);
  const minSyOut = parseAmount(minSyInput.value || "0", view.syDecimals);
  const router = new ethers.Contract(PENDLE_ROUTER_V4, PENDLE_ROUTER_ABI);

  return {
    id: `pt:${view.marketAddress.toLowerCase()}`,
    marketAddress: view.marketAddress,
    label: `${view.underlyingLabel}: expired PT -> SY ${formatBalance(amount, view.ptDecimals)} ${view.ptSymbol}`,
    target: PENDLE_ROUTER_V4,
    callData: router.interface.encodeFunctionData("exitPostExpToSy", [
      state.account,
      view.marketAddress,
      amount,
      0n,
      minSyOut
    ]),
    approvalTokenAddress: view.ptAddress,
    approvalAmount: amount
  };
}

async function buildQueuedSyRouterCall(view: PendleMarketView, card: HTMLElement): Promise<QueuedRouterCall> {
  const amountInput = card.querySelector<HTMLInputElement>(".sy-amount");
  const minTokenInput = card.querySelector<HTMLInputElement>(".sy-min-token-out");
  const redeemTokenSelect = card.querySelector<HTMLSelectElement>(".redeem-token-select");
  if (!amountInput || !minTokenInput || !redeemTokenSelect) {
    throw new Error("SY queue inputs are missing");
  }

  const selectedOutput = view.outputTokens.find((token) => token.address === redeemTokenSelect.value)
    ?? await ensureSyAssetToken(view);
  if (!selectedOutput) {
    throw new Error("Choose a redeem token first");
  }

  const amount = parseAmount(amountInput.value, view.syDecimals);
  const minTokenOut = parseAmount(minTokenInput.value || "0", selectedOutput.decimals);
  const router = new ethers.Contract(PENDLE_ROUTER_V4, PENDLE_ROUTER_ABI);

  return {
    id: `sy:${view.marketAddress.toLowerCase()}:${selectedOutput.address.toLowerCase()}`,
    marketAddress: view.marketAddress,
    label: `${view.underlyingLabel}: SY -> ${selectedOutput.symbol} ${formatBalance(amount, view.syDecimals)} ${view.sySymbol}`,
    target: PENDLE_ROUTER_V4,
    callData: router.interface.encodeFunctionData("redeemSyToToken", [
      state.account,
      view.syAddress,
      amount,
      {
        tokenOut: selectedOutput.address,
        minTokenOut,
        tokenRedeemSy: selectedOutput.address,
        pendleSwap: ethers.ZeroAddress,
        swapData: ZERO_SWAP_DATA
      }
    ]),
    approvalTokenAddress: view.syAddress,
    approvalAmount: amount
  };
}

async function submitQueuedRouterMulticall(): Promise<void> {
  if (!state.queuedRouterCalls.length) {
    throw new Error("No queued router calls");
  }

  await connectAndSwitchForAction();
  const router = new ethers.Contract(PENDLE_ROUTER_V4, PENDLE_ROUTER_ABI, state.signer);
  if (!(await routerSupportsMulticall(router))) {
    throw new Error("Pendle router multicall is not available on this chain");
  }

  for (const call of state.queuedRouterCalls) {
    if (call.approvalTokenAddress && call.approvalAmount) {
      await ensureApproval(call.approvalTokenAddress, call.approvalAmount);
    }
  }

  const tx = await router.multicall(
    state.queuedRouterCalls.map((call) => ({
      target: call.target,
      allowFailure: false,
      callData: call.callData
    }))
  );
  await tx.wait();
  clearQueuedRouterCalls();
}

async function performBatchSweep(): Promise<void> {
  if (!useBatchWalletRequests()) {
    throw new Error("Enable batched sweep requests in debug mode first");
  }

  await connectAndSwitchForAction();

  const router = new ethers.Contract(PENDLE_ROUTER_V4, PENDLE_ROUTER_ABI, state.signer);
  const routerInterface = new ethers.Interface(PENDLE_ROUTER_ABI);
  const erc20Interface = new ethers.Interface(ERC20_ABI);
  const marketInterface = new ethers.Interface(MARKET_ABI);
  const ptSweepable = state.renderedMarkets.filter((view) => view.ptBalance > 0n);
  const activePtSweepable = ptSweepable.filter((view) => !view.isExpired);
  const expiredPtSweepable = ptSweepable.filter((view) => view.isExpired);
  const syCandidates = state.renderedMarkets.filter((view) => view.syBalance > 0n);
  const sySweepable: PendleMarketView[] = [];
  const syOutputByAddress = new Map<string, TokenOption>();
  for (const view of syCandidates) {
    const outputToken = chooseDefaultOutputToken(view) ?? await ensureSyAssetToken(view);
    if (!outputToken) {
      continue;
    }
    sySweepable.push(view);
    syOutputByAddress.set(view.syAddress.toLowerCase(), outputToken);
  }

  const syCalls = sySweepable.map((view) => {
    const outputToken = syOutputByAddress.get(view.syAddress.toLowerCase()) ?? chooseDefaultOutputToken(view);
    if (!outputToken) {
      return null;
    }

    return {
      target: PENDLE_ROUTER_V4,
      allowFailure: false,
      callData: routerInterface.encodeFunctionData("redeemSyToToken", [
        state.account,
        view.syAddress,
        view.syBalance,
        {
          tokenOut: outputToken.address,
          minTokenOut: 0n,
          tokenRedeemSy: outputToken.address,
          pendleSwap: ethers.ZeroAddress,
          swapData: ZERO_SWAP_DATA
        }
      ])
    };
  }).filter((value): value is { target: string; allowFailure: boolean; callData: string } => Boolean(value));

  const expiredPtCalls = expiredPtSweepable.map((view) => ({
    target: PENDLE_ROUTER_V4,
    allowFailure: false,
    callData: routerInterface.encodeFunctionData("exitPostExpToSy", [
      state.account,
      view.marketAddress,
      view.ptBalance,
      0n,
      0n
    ])
  }));

  const submitted: string[] = [];

  const walletCalls: WalletBatchCall[] = [];
  for (const view of expiredPtSweepable) {
    const approvalCall = await getApprovalCallIfNeeded(view.ptAddress, view.ptBalance);
    if (approvalCall) {
      walletCalls.push(approvalCall);
    }
  }

  for (const view of sySweepable) {
    const approvalCall = await getApprovalCallIfNeeded(view.syAddress, view.syBalance);
    if (approvalCall) {
      walletCalls.push(approvalCall);
    }
  }

  for (const view of activePtSweepable) {
    walletCalls.push({
      to: view.ptAddress,
      data: erc20Interface.encodeFunctionData("transfer", [view.marketAddress, view.ptBalance])
    });
    walletCalls.push({
      to: view.marketAddress,
      data: marketInterface.encodeFunctionData("swapExactPtForSy", [state.account, view.ptBalance, "0x"])
    });
  }

  const routerCalls = [...expiredPtCalls, ...syCalls];
  if (routerCalls.length) {
    if (await routerSupportsMulticall(router)) {
      walletCalls.push({
        to: PENDLE_ROUTER_V4,
        data: routerInterface.encodeFunctionData("multicall", [routerCalls])
      });
    } else {
      for (const view of expiredPtSweepable) {
        walletCalls.push({
          to: PENDLE_ROUTER_V4,
          data: routerInterface.encodeFunctionData("exitPostExpToSy", [
            state.account,
            view.marketAddress,
            view.ptBalance,
            0n,
            0n
          ])
        });
      }

      for (const view of sySweepable) {
        const outputToken = syOutputByAddress.get(view.syAddress.toLowerCase()) ?? chooseDefaultOutputToken(view);
        if (!outputToken) {
          continue;
        }

        walletCalls.push({
          to: PENDLE_ROUTER_V4,
          data: routerInterface.encodeFunctionData("redeemSyToToken", [
            state.account,
            view.syAddress,
            view.syBalance,
            {
              tokenOut: outputToken.address,
              minTokenOut: 0n,
              tokenRedeemSy: outputToken.address,
              pendleSwap: ethers.ZeroAddress,
              swapData: ZERO_SWAP_DATA
            }
          ])
        });
      }
    }
  }

  const batchedSubmission = await tryWalletBatchSweep(walletCalls);
  if (batchedSubmission?.length) {
    submitted.push(...batchedSubmission);
    return;
  }

  for (const view of expiredPtSweepable) {
    await ensureApproval(view.ptAddress, view.ptBalance);
  }

  for (const view of sySweepable) {
    await ensureApproval(view.syAddress, view.syBalance);
  }

  for (const view of activePtSweepable) {
    const pt = new ethers.Contract(view.ptAddress, ERC20_ABI, state.signer);
    const market = new ethers.Contract(view.marketAddress, MARKET_ABI, state.signer);
    const transferTx = await pt.transfer(view.marketAddress, view.ptBalance);
    submitted.push(transferTx.hash);
    await transferTx.wait();
    const swapTx = await market.swapExactPtForSy(state.account, view.ptBalance, "0x");
    submitted.push(swapTx.hash);
    await swapTx.wait();
  }
  if (routerCalls.length) {
    if (await routerSupportsMulticall(router)) {
      try {
        const tx = await router.multicall(routerCalls);
        submitted.push(tx.hash);
        await tx.wait();
      } catch (error) {
        if (!errorMessageIncludesInvalidSelector(error)) {
          throw error;
        }

        state.routerMulticallSupport[state.selectedChainKey] = false;
      }
    }

    if (state.routerMulticallSupport[state.selectedChainKey] === false) {
      for (const view of expiredPtSweepable) {
        const exitTx = await router.exitPostExpToSy(state.account, view.marketAddress, view.ptBalance, 0n, 0n);
        submitted.push(exitTx.hash);
        await exitTx.wait();
      }

      for (const view of sySweepable) {
        const outputToken = syOutputByAddress.get(view.syAddress.toLowerCase()) ?? chooseDefaultOutputToken(view);
        if (!outputToken) {
          continue;
        }

        const redeemTx = await router.redeemSyToToken(
          state.account,
          view.syAddress,
          view.syBalance,
          {
            tokenOut: outputToken.address,
            minTokenOut: 0n,
            tokenRedeemSy: outputToken.address,
            pendleSwap: ethers.ZeroAddress,
            swapData: ZERO_SWAP_DATA
          }
        );
        submitted.push(redeemTx.hash);
        await redeemTx.wait();
      }
    }
  }

  if (!submitted.length) {
    throw new Error("No PT or SY balances available for batched sweep");
  }
}

async function refreshPageData(): Promise<void> {
  try {
    const chain = getSelectedChain();
    elements.selectedChainStatus.textContent = `${chain.name} (${chain.chainId})`;
    await refreshWalletSession();
    state.renderedMarkets = await loadMarketViews();
    renderMarkets();
    renderDebugPanel();
    setNotice(
      "Review min-out fields before sending. This page uses direct RouterV4 calls, no hosted SDK quote generation, no external aggregator routes, and empty Pendle limit-order data.",
      "good"
    );
  } finally {
    finishLoading();
  }
}

function bindEvents(): void {
  elements.debugToggle.addEventListener("change", () => {
    renderDebugPanel();
  });

  elements.batchWalletRequestsToggle.addEventListener("change", () => {
    renderDebugPanel();
  });

  elements.activeMarketsOnlyToggle.addEventListener("change", async () => {
    try {
      await refreshPageData();
    } catch (error) {
      setNotice((error as Error).message, "error");
    }
  });

  elements.connectButton.addEventListener("click", async () => {
    try {
      await connectWallet();
      await refreshPageData();
    } catch (error) {
      setNotice((error as Error).message, "error");
    }
  });

  elements.refreshButton.addEventListener("click", async () => {
    try {
      await refreshPageData();
    } catch (error) {
      setNotice((error as Error).message, "error");
    }
  });

  elements.chainSelect.addEventListener("change", async () => {
    state.selectedChainKey = elements.chainSelect.value;
    try {
      await refreshPageData();
    } catch (error) {
      setNotice((error as Error).message, "error");
    }
  });

  elements.sweepButton.addEventListener("click", async () => {
    try {
      await performBatchSweep();
      await refreshPageData();
      setNotice("Batched sweep submitted and confirmed for the current chain.", "good");
    } catch (error) {
      setNotice((error as Error).message, "error");
    }
  });

  elements.queueSubmitButton.addEventListener("click", async () => {
    try {
      await submitQueuedRouterMulticall();
      await refreshPageData();
      setNotice("Queued Pendle router multicall submitted and confirmed.", "good");
    } catch (error) {
      setNotice((error as Error).message, "error");
    }
  });

  elements.queueClearButton.addEventListener("click", () => {
    clearQueuedRouterCalls();
    setNotice("Cleared queued router calls.", "good");
  });

  elements.marketList.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    const card = target.closest<HTMLElement>("[data-market-index]");
    if (!card) {
      return;
    }

    const marketIndex = Number(card.dataset.marketIndex);
    const view = state.renderedMarkets[marketIndex];
    if (!view) {
      return;
    }

    try {
      if (target.classList.contains("swap-pt-button")) {
        await performPtSwap(view, card);
        await refreshPageData();
      } else if (target.classList.contains("queue-pt-router-button")) {
        const queued = await buildQueuedPtRouterCall(view, card);
        upsertQueuedRouterCall(queued);
        setNotice("Queued expired PT router call.", "good");
      } else if (target.classList.contains("redeem-sy-button")) {
        await performSyRedeem(view, card);
        await refreshPageData();
      } else if (target.classList.contains("queue-sy-router-button")) {
        const queued = await buildQueuedSyRouterCall(view, card);
        upsertQueuedRouterCall(queued);
        setNotice("Queued SY router call.", "good");
      }
    } catch (error) {
      const resultDisplay = card.querySelector<HTMLInputElement>(".result-display");
      if (resultDisplay) {
        resultDisplay.value = (error as Error).message.slice(0, 120);
      }
      setNotice((error as Error).message, "error");
    }
  });

  if (window.ethereum) {
    window.ethereum.on?.("accountsChanged", async () => {
      state.browserProvider = null;
      await refreshPageData().catch((error: Error) => setNotice(error.message, "error"));
    });

    window.ethereum.on?.("chainChanged", async () => {
      state.browserProvider = null;
      await refreshPageData().catch((error: Error) => setNotice(error.message, "error"));
    });
  }
}

async function main(): Promise<void> {
  populateChainSelect();
  renderLoadingState();
  await loadPendleConfig();
  await loadChainlistRpcs();
  bindEvents();
  await refreshPageData();
  renderDebugPanel();
}

main().catch((error) => {
  setNotice(error instanceof Error ? error.message : "Unknown error", "error");
});
