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
  renderedMarkets: []
};

const READ_RPC_TIMEOUT_MS = 3000;
const WALLET_CALLS_STATUS_PENDING = 100;
const WALLET_CALLS_STATUS_CONFIRMED = 200;
const WALLET_CALLS_STATUS_OFFCHAIN_FAILED = 400;
const WALLET_CALLS_STATUS_CHAIN_FAILED = 500;
const WALLET_CALLS_STATUS_PARTIAL_FAILED = 600;

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
    debugToggle: byId<HTMLInputElement>("debugToggle"),
    debugPanel: byId("debugPanel"),
    batchWalletRequestsToggle: byId<HTMLInputElement>("batchWalletRequestsToggle"),
    sweepButton: byId<HTMLButtonElement>("sweepButton"),
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

function useBatchWalletRequests(): boolean {
  return Boolean(elements.batchWalletRequestsToggle.checked);
}

function renderDebugPanel(): void {
  elements.debugPanel.classList.toggle("hidden", !elements.debugToggle.checked);
  const hasSweepableMarkets = state.renderedMarkets.some((view) => view.ptBalance > 0n || view.syBalance > 0n);
  elements.sweepButton.disabled = !state.account || !hasSweepableMarkets || !useBatchWalletRequests();
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
      ytAddress: market.ytAddress ? ethers.getAddress(market.ytAddress) : undefined
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
    "infura.io",
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
  const dynamic = state.rpcCatalog[chain.key] || [];
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
    throw new Error(`Multicall3 unavailable on ${chain.name}`);
  }

  const contract = new ethers.Contract(multicall, MULTICALL3_ABI, provider);
  const results: Array<{ success: boolean; returnData: string }> = [];
  const chunkSize = 100;

  for (let index = 0; index < calls.length; index += chunkSize) {
    const chunk = calls.slice(index, index + chunkSize).map((call) => ({
      target: call.target,
      allowFailure: call.allowFailure ?? true,
      callData: call.callData
    }));
    const response = (await contract.aggregate3(chunk)) as Array<{ success: boolean; returnData: string }>;
    results.push(...response);
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
  const marketRecords = state.pendleMarkets.filter((item) => item.chainKey === chain.key);
  elements.marketCountStatus.value = `${marketRecords.length} configured`;

  if (!state.account) {
    return [];
  }

  const marketInterface = new ethers.Interface(MARKET_ABI);
  const erc20Interface = new ethers.Interface(ERC20_ABI);
  const syInterface = new ethers.Interface(SY_ABI);
  const missingMarketRecords = marketRecords.filter((record) => !state.marketResolutionCache[getMarketCacheKey(chain.key, record.marketAddress)]);
  if (missingMarketRecords.length) {
    await withRotatingProvider("resolve Pendle markets", async (provider) => {
      const marketCalls = missingMarketRecords.flatMap((item) => [
        { target: item.marketAddress, callData: marketInterface.encodeFunctionData("readTokens") },
        { target: item.marketAddress, callData: marketInterface.encodeFunctionData("isExpired") }
      ]);
      const marketResults = await aggregateCalls(provider, marketCalls);

      for (let index = 0; index < missingMarketRecords.length; index += 1) {
        const record = missingMarketRecords[index];
        const tokensResult = marketResults[index * 2];
        const expiredResult = marketResults[index * 2 + 1];
        if (!tokensResult?.success || !expiredResult?.success) {
          continue;
        }

        const resolvedTokens = decodeTupleResult<[string, string, string]>(marketInterface, "readTokens", tokensResult);
        const isExpired = decodeSingleResult<boolean>(marketInterface, "isExpired", expiredResult);
        if (!resolvedTokens || isExpired === null) {
          continue;
        }
        const [resolvedSyAddress, resolvedPtAddress, resolvedYtAddress] = resolvedTokens;
        state.marketResolutionCache[getMarketCacheKey(chain.key, record.marketAddress)] = {
          syAddress: record.syAddress ? ethers.getAddress(record.syAddress) : ethers.getAddress(resolvedSyAddress),
          ptAddress: record.ptAddress ? ethers.getAddress(record.ptAddress) : ethers.getAddress(resolvedPtAddress),
          ytAddress: record.ytAddress ? ethers.getAddress(record.ytAddress) : ethers.getAddress(resolvedYtAddress),
          isExpired
        };
      }
      return true;
    });
  }

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
  if (missingTokenEntries.length) {
    await withRotatingProvider("load Pendle token metadata", async (provider) => {
      const tokenCalls = missingTokenEntries.flatMap((entry) => {
        const calls = [
          { target: entry.tokenAddress, callData: erc20Interface.encodeFunctionData("symbol") },
          { target: entry.tokenAddress, callData: erc20Interface.encodeFunctionData("decimals") }
        ];

        if (entry.type === "sy") {
          calls.push(
            { target: entry.tokenAddress, callData: syInterface.encodeFunctionData("getTokensOut") },
            { target: entry.tokenAddress, callData: syInterface.encodeFunctionData("assetInfo") }
          );
        }

        return calls;
      });
      const tokenResults = await aggregateCalls(provider, tokenCalls);

      let cursor = 0;
      for (const entry of missingTokenEntries) {
        const symbolResult = tokenResults[cursor++];
        const decimalsResult = tokenResults[cursor++];
        if (!symbolResult?.success || !decimalsResult?.success) {
          if (entry.type === "sy") {
            cursor += 2;
          }
          continue;
        }

        const symbol = decodeSingleResult<string>(erc20Interface, "symbol", symbolResult);
        const decimals = decodeSingleResult<bigint>(erc20Interface, "decimals", decimalsResult);
        if (!symbol || decimals === null) {
          if (entry.type === "sy") {
            cursor += 2;
          }
          continue;
        }
        const metadata: CachedTokenMetadata = {
          symbol,
          decimals: Number(decimals),
          outputs: [],
          assetTokenAddress: null
        };

        if (entry.type === "sy") {
          const outputsResult = tokenResults[cursor++];
          const assetInfoResult = tokenResults[cursor++];
          const outputs = decodeSingleResult<string[]>(syInterface, "getTokensOut", outputsResult);
          if (outputs) {
            metadata.outputs = outputs.map((value) => ethers.getAddress(value));
          }
          const assetInfo = decodeTupleResult<[bigint, string, bigint]>(syInterface, "assetInfo", assetInfoResult);
          if (assetInfo) {
            const [, assetTokenAddress] = assetInfo;
            if (assetTokenAddress !== ethers.ZeroAddress) {
              metadata.assetTokenAddress = ethers.getAddress(assetTokenAddress);
            }
          }
        }

        state.tokenMetadataCache[getTokenCacheKey(chain.key, entry.tokenAddress)] = metadata;
      }
      return true;
    });
  }

  const outputTokenAddresses = [...new Set(
    tokenEntries.flatMap((entry) => {
      if (entry.type !== "sy") {
        return [];
      }
      const metadata = state.tokenMetadataCache[getTokenCacheKey(chain.key, entry.tokenAddress)];
      if (!metadata) {
        return [];
      }
      const addresses = [...metadata.outputs];
      if (metadata.assetTokenAddress) {
        addresses.push(metadata.assetTokenAddress);
      }
      return addresses;
    })
  )];

  const missingOutputTokenAddresses = outputTokenAddresses.filter((address) => !state.tokenMetadataCache[getTokenCacheKey(chain.key, address)]);
  if (missingOutputTokenAddresses.length) {
    await withRotatingProvider("load Pendle output token metadata", async (provider) => {
      const outputTokenCalls = missingOutputTokenAddresses.flatMap((tokenAddress) => [
        { target: tokenAddress, callData: erc20Interface.encodeFunctionData("symbol") },
        { target: tokenAddress, callData: erc20Interface.encodeFunctionData("decimals") }
      ]);
      const outputTokenResults = await aggregateCalls(provider, outputTokenCalls);

      for (let index = 0; index < missingOutputTokenAddresses.length; index += 1) {
        const symbolResult = outputTokenResults[index * 2];
        const decimalsResult = outputTokenResults[index * 2 + 1];
        if (!symbolResult?.success || !decimalsResult?.success) {
          continue;
        }
        const symbol = decodeSingleResult<string>(erc20Interface, "symbol", symbolResult);
        const decimals = decodeSingleResult<bigint>(erc20Interface, "decimals", decimalsResult);
        if (!symbol || decimals === null) {
          continue;
        }
        state.tokenMetadataCache[getTokenCacheKey(chain.key, missingOutputTokenAddresses[index])] = {
          symbol,
          decimals: Number(decimals),
          outputs: [],
          assetTokenAddress: null
        };
      }
      return true;
    });
  }

  const balancesByKey = new Map<string, bigint>();
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
      outputTokens: syMetadata.outputs
        .map((address) => {
          const metadata = state.tokenMetadataCache[getTokenCacheKey(chain.key, address)];
          if (!metadata) {
            return null;
          }
          return {
            address,
            symbol: metadata.symbol,
            decimals: metadata.decimals
          };
        })
        .filter((value): value is TokenOption => Boolean(value)),
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
      .join("");

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
          <button class="redeem-sy-button" type="button"${view.syBalance > 0n && view.outputTokens.length > 0 ? "" : " disabled"}>Redeem SY -> token</button>
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

  const selectedOutput = view.outputTokens.find((token) => token.address === redeemTokenSelect.value);
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
  const sySweepable = state.renderedMarkets.filter((view) => view.syBalance > 0n && chooseDefaultOutputToken(view));

  const syCalls = sySweepable.map((view) => {
    const outputToken = chooseDefaultOutputToken(view);
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
        const outputToken = chooseDefaultOutputToken(view);
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
        const outputToken = chooseDefaultOutputToken(view);
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
}

function bindEvents(): void {
  elements.debugToggle.addEventListener("change", () => {
    renderDebugPanel();
  });

  elements.batchWalletRequestsToggle.addEventListener("change", () => {
    renderDebugPanel();
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
      } else if (target.classList.contains("redeem-sy-button")) {
        await performSyRedeem(view, card);
        await refreshPageData();
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
  await loadPendleConfig();
  await loadChainlistRpcs();
  bindEvents();
  await refreshPageData();
  renderDebugPanel();
}

main().catch((error) => {
  setNotice(error instanceof Error ? error.message : "Unknown error", "error");
});
