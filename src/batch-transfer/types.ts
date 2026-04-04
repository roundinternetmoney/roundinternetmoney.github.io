import type { ethers } from "ethers";

export type StrategyKey = "sequential_calls" | "permit_batch_signer";
export type TokenSelectionMode = "all_known_tokens" | "selected_known_tokens";
export type NoticeKind = "error" | "good" | undefined;

export interface ChainConfig {
  key: string;
  name: string;
  chainId: number;
  rpcUrls: string[];
  blockExplorerUrls: string[];
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  multicall3: string;
}

export interface StrategyConfig {
  label: string;
  supportsNative: boolean;
  supportsErc20: boolean;
}

export interface AppConfig {
  chains: ChainConfig[];
  strategies: Record<StrategyKey, StrategyConfig>;
}

export interface CatalogToken {
  chainKey: string;
  address: string;
  symbol?: string;
  sourceSymbol?: string;
  decimals?: number | null;
}

export interface KnownTokenConfig {
  address: string;
  symbol: string;
  decimals?: number | null;
}

export interface KnownTokenBalance {
  address: string;
  symbol: string;
  decimals: number;
  balanceRaw: bigint;
  balanceFormatted: string;
  error?: string;
  sourceSymbol?: string;
}

export interface DebugState {
  readMode: string;
  configuredTokenCount: number;
  queriedAddresses: string[];
  nonZeroAddresses: string[];
  failures: string[];
  activeRpc: string;
  currentScanAccount: string | null;
}

export interface ScanCacheEntry {
  results: KnownTokenBalance[];
  readMode: string;
  configuredTokenCount: number;
  queriedAddresses: string[];
  nonZeroAddresses: string[];
  failures: string[];
}

export interface AppState {
  browserProvider: ethers.BrowserProvider | null;
  signer: ethers.JsonRpcSigner | null;
  account: string | null;
  knownTokenBalances: KnownTokenBalance[];
  selectedTokenAddresses: string[];
  enrichedTokens: CatalogToken[];
  enrichedTokensLoaded: boolean;
  chainlistLoaded: boolean;
  rpcCatalog: Record<string, string[]>;
  debug: DebugState;
  scanCache: Record<string, ScanCacheEntry>;
  scanVersion: number;
}

export interface Elements {
  chainSelect: HTMLSelectElement;
  modeDisplay: HTMLInputElement;
  executionStrategy: HTMLSelectElement;
  tokenSelectionMode: HTMLSelectElement;
  connectButton: HTMLButtonElement;
  scanBalancesButton: HTMLButtonElement;
  debugToggle: HTMLInputElement;
  debugPanel: HTMLElement;
  sendButton: HTMLButtonElement;
  singleRecipient: HTMLInputElement;
  maxTokenTransfers: HTMLInputElement;
  approvalTarget: HTMLInputElement;
  actionModeDisplay: HTMLInputElement;
  rapidSubmitToggle: HTMLInputElement;
  nativeFallbackToggle: HTMLInputElement;
  tokenTransferList: HTMLElement;
  walletNotice: HTMLElement;
  transferNotice: HTMLElement;
  configuredChainStatus: HTMLElement;
  walletChainStatus: HTMLElement;
  accountStatus: HTMLElement;
  balanceStatus: HTMLElement;
  multicallStatus: HTMLElement;
  assetList: HTMLElement;
  debugCatalogLoaded: HTMLElement;
  debugChain: HTMLElement;
  debugCatalogCount: HTMLElement;
  debugReadMode: HTMLElement;
  debugMaxRetries: HTMLElement;
  debugActiveRpc: HTMLElement;
  debugQueried: HTMLElement;
  debugNonzero: HTMLElement;
  debugFailures: HTMLElement;
  privateKeyInput: HTMLInputElement;
  signingModeDisplay: HTMLInputElement;
}

export interface ExecutionPlan {
  strategy: StrategyKey;
  tokenMode: TokenSelectionMode;
  chainKey: string;
  recipient: string;
  approvalTarget: string;
  rapidSubmit: boolean;
  nativeFallback: boolean;
  maxTokenTransfers: number;
  knownTokenBalances: KnownTokenBalance[];
  tokenTransfers: KnownTokenBalance[];
}

export interface TokenStateEntry {
  address: string;
  symbol: string;
  decimals: number | null;
  balanceRaw: bigint;
}
