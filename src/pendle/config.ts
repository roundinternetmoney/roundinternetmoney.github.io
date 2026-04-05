import { ethers } from "ethers";
import { APP_CONFIG, CHAINLIST_RPCS_URL } from "../batch-transfer/config";
import type { PendleChainConfig } from "./types";

export { CHAINLIST_RPCS_URL };

export const PENDLE_ROUTER_V4 = "0x888888888889758F76e7103c6CbF23ABbF58F946";

export const MARKET_ABI = [
  "function readTokens() view returns (address SY, address PT, address YT)",
  "function isExpired() view returns (bool)",
  "function swapExactPtForSy(address receiver,uint256 exactPtIn,bytes data) returns (uint256 netSyOut, uint256 netSyFee)"
];

export const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)"
];

export const SY_ABI = [
  "function getTokensOut() view returns (address[] memory res)",
  "function assetInfo() view returns (uint8 assetType, address assetAddress, uint8 assetDecimals)",
  "function previewRedeem(address tokenOut, uint256 amountSharesToRedeem) view returns (uint256 amountTokenOut)"
];

export const MULTICALL3_ABI = [
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success, bytes returnData)[] returnData)"
];

export const PENDLE_ROUTER_ABI = [
  "function swapExactPtForSy(address receiver,address market,uint256 exactPtIn,uint256 minSyOut,(address limitRouter,uint256 epsSkipMarket,(address,uint256,uint256,(uint8,address,bytes,bool),bytes)[] normalFills,(address,uint256,uint256,(uint8,address,bytes,bool),bytes)[] flashFills,bytes optData) limit) returns (uint256 netSyOut, uint256 netSyFee)",
  "function swapExactPtForToken(address receiver,address market,uint256 exactPtIn,(address tokenOut,uint256 minTokenOut,address tokenRedeemSy,address pendleSwap,(uint8 swapType,address extRouter,bytes extCalldata,bool needScale) swapData) output,(address limitRouter,uint256 epsSkipMarket,(address,uint256,uint256,(uint8,address,bytes,bool),bytes)[] normalFills,(address,uint256,uint256,(uint8,address,bytes,bool),bytes)[] flashFills,bytes optData) limit) returns (uint256 netTokenOut, uint256 netSyFee, uint256 netSyInterm)",
  "function exitPostExpToSy(address receiver,address market,uint256 netPtIn,uint256 netLpIn,uint256 minSyOut) returns ((uint256 totalPtOut,uint256 totalSyOut,uint256 totalLpOut,uint256 netSyFee,uint256 netSyToReserve) params)",
  "function redeemSyToToken(address receiver,address SY,uint256 netSyIn,(address tokenOut,uint256 minTokenOut,address tokenRedeemSy,address pendleSwap,(uint8 swapType,address extRouter,bytes extCalldata,bool needScale) swapData) output) returns (uint256 netTokenOut)",
  "function multicall((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] res)"
];

export const ZERO_SWAP_DATA = {
  swapType: 0,
  extRouter: ethers.ZeroAddress,
  extCalldata: "0x",
  needScale: false
} as const;

export const EMPTY_LIMIT_ORDER = {
  limitRouter: ethers.ZeroAddress,
  epsSkipMarket: 0n,
  normalFills: [],
  flashFills: [],
  optData: "0x"
} as const;

const SUPPORTED_CHAIN_KEYS = [
  "ethereum",
  "arbitrum",
  "base",
  "binancechain",
  "sonic",
  "mantle",
  "berachain",
  "hyperliquid"
] as const;

export const PENDLE_CHAIN_CONFIGS: PendleChainConfig[] = APP_CONFIG.chains
  .filter((chain) => SUPPORTED_CHAIN_KEYS.includes(chain.key as (typeof SUPPORTED_CHAIN_KEYS)[number]))
  .map((chain) => ({
    key: chain.key,
    name: chain.name,
    chainId: chain.chainId,
    rpcUrls: chain.rpcUrls,
    blockExplorerUrl: chain.blockExplorerUrls[0] ?? "",
    multicall3: chain.multicall3
  }));
