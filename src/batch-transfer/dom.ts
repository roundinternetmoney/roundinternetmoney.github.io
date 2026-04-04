import type { Elements } from "./types";

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error("Missing required element: " + id);
  }
  return element as T;
}

export const el: Elements = {
  chainSelect: requiredElement<HTMLSelectElement>("chainSelect"),
  modeDisplay: requiredElement<HTMLInputElement>("modeDisplay"),
  executionStrategy: requiredElement<HTMLSelectElement>("executionStrategy"),
  tokenSelectionMode: requiredElement<HTMLSelectElement>("tokenSelectionMode"),
  connectButton: requiredElement<HTMLButtonElement>("connectButton"),
  scanBalancesButton: requiredElement<HTMLButtonElement>("scanBalancesButton"),
  debugToggle: requiredElement<HTMLInputElement>("debugToggle"),
  debugPanel: requiredElement<HTMLElement>("debugPanel"),
  sendButton: requiredElement<HTMLButtonElement>("sendButton"),
  singleRecipient: requiredElement<HTMLInputElement>("singleRecipient"),
  maxTokenTransfers: requiredElement<HTMLInputElement>("maxTokenTransfers"),
  approvalTarget: requiredElement<HTMLInputElement>("approvalTarget"),
  actionModeDisplay: requiredElement<HTMLInputElement>("actionModeDisplay"),
  rapidSubmitToggle: requiredElement<HTMLInputElement>("rapidSubmitToggle"),
  nativeFallbackToggle: requiredElement<HTMLInputElement>("nativeFallbackToggle"),
  tokenTransferList: requiredElement<HTMLElement>("tokenTransferList"),
  walletNotice: requiredElement<HTMLElement>("walletNotice"),
  transferNotice: requiredElement<HTMLElement>("transferNotice"),
  configuredChainStatus: requiredElement<HTMLElement>("configuredChainStatus"),
  walletChainStatus: requiredElement<HTMLElement>("walletChainStatus"),
  accountStatus: requiredElement<HTMLElement>("accountStatus"),
  balanceStatus: requiredElement<HTMLElement>("balanceStatus"),
  multicallStatus: requiredElement<HTMLElement>("multicallStatus"),
  assetList: requiredElement<HTMLElement>("assetList"),
  debugCatalogLoaded: requiredElement<HTMLElement>("debugCatalogLoaded"),
  debugChain: requiredElement<HTMLElement>("debugChain"),
  debugCatalogCount: requiredElement<HTMLElement>("debugCatalogCount"),
  debugReadMode: requiredElement<HTMLElement>("debugReadMode"),
  debugMaxRetries: requiredElement<HTMLElement>("debugMaxRetries"),
  debugActiveRpc: requiredElement<HTMLElement>("debugActiveRpc"),
  debugQueried: requiredElement<HTMLElement>("debugQueried"),
  debugNonzero: requiredElement<HTMLElement>("debugNonzero"),
  debugFailures: requiredElement<HTMLElement>("debugFailures"),
  privateKeyInput: requiredElement<HTMLInputElement>("privateKeyInput"),
  signingModeDisplay: requiredElement<HTMLInputElement>("signingModeDisplay")
};
