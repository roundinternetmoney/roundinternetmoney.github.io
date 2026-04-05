import type { ethers } from "ethers";

export interface PendleChainConfig {
  key: string;
  name: string;
  chainId: number;
  rpcUrls: string[];
  blockExplorerUrl: string;
  multicall3: string;
}

export interface PendleCatalog {
  generatedAt: string | null;
  source: string;
  markets: PendleMarketRecord[];
}

export interface PendleMarketRecord {
  chainKey: string;
  chainName: string;
  chainId: number;
  marketAddress: string;
  underlyingLabel: string;
  decimalsSY: number | null;
  decimalsPT: number | null;
  ptSymbol?: string | null;
  sySymbol?: string | null;
  ptAddress?: string;
  syAddress?: string;
  ytAddress?: string;
  assetTokenAddress?: string | null;
  assetTokenDecimals?: number | null;
  redeemOptions?: TokenOption[];
}

export interface TokenOption {
  address: string;
  symbol: string;
  decimals: number;
}

export interface PendleMarketView {
  chainKey: string;
  chainName: string;
  marketAddress: string;
  underlyingLabel: string;
  ptAddress: string;
  ptSymbol: string;
  ptDecimals: number;
  ptBalance: bigint;
  syAddress: string;
  sySymbol: string;
  syDecimals: number;
  syBalance: bigint;
  ytAddress: string;
  isExpired: boolean;
  outputTokens: TokenOption[];
  assetTokenAddress: string | null;
}

export interface CachedMarketResolution {
  ptAddress: string;
  syAddress: string;
  ytAddress: string;
  isExpired: boolean;
}

export interface CachedTokenMetadata {
  symbol: string;
  decimals: number;
  outputs: string[];
  assetTokenAddress: string | null;
  assetTokenDecimals: number | null;
}

export interface AppState {
  browserProvider: ethers.BrowserProvider | null;
  signer: ethers.JsonRpcSigner | null;
  account: string | null;
  selectedChainKey: string;
  readProvider: ethers.JsonRpcProvider | null;
  chainlistLoaded: boolean;
  rpcCatalog: Record<string, string[]>;
  marketResolutionCache: Record<string, CachedMarketResolution>;
  tokenMetadataCache: Record<string, CachedTokenMetadata>;
  routerMulticallSupport: Record<string, boolean>;
  pendleMarkets: PendleMarketRecord[];
  renderedMarkets: PendleMarketView[];
  loading: {
    active: boolean;
    label: string;
    current: number;
    total: number;
  };
  queuedRouterCalls: QueuedRouterCall[];
}

export interface QueuedRouterCall {
  id: string;
  marketAddress: string;
  label: string;
  target: string;
  callData: string;
  approvalTokenAddress?: string;
  approvalAmount?: bigint;
}

export interface Elements {
  chainSelect: HTMLSelectElement;
  connectButton: HTMLButtonElement;
  refreshButton: HTMLButtonElement;
  activeMarketsOnlyToggle: HTMLInputElement;
  loadingPanel: HTMLElement;
  loadingSpinner: HTMLElement;
  loadingLabel: HTMLElement;
  loadingProgressBar: HTMLElement;
  loadingProgressText: HTMLElement;
  debugToggle: HTMLInputElement;
  debugPanel: HTMLElement;
  batchWalletRequestsToggle: HTMLInputElement;
  sweepButton: HTMLButtonElement;
  queuedCallsPanel: HTMLElement;
  queuedCallsList: HTMLElement;
  queueSubmitButton: HTMLButtonElement;
  queueClearButton: HTMLButtonElement;
  accountStatus: HTMLElement;
  walletChainStatus: HTMLElement;
  selectedChainStatus: HTMLElement;
  marketCountStatus: HTMLInputElement;
  notice: HTMLElement;
  summary: HTMLElement;
  marketList: HTMLElement;
}
