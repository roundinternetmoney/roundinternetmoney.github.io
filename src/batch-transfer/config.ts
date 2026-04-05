import type { AppConfig } from "./types";

export const MULTICALL3_ABI = [
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success, bytes returnData)[] returnData)",
  "function aggregate3Value((address target,bool allowFailure,uint256 value,bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)"
];

export const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

export const MAX_SCAN_RETRIES = 5;
export const CHAINLIST_RPCS_URL = "https://chainlist.org/rpcs.json";

export const APP_CONFIG: AppConfig = {
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
      key: "optimism",
      name: "Optimism",
      chainId: 10,
      rpcUrls: ["https://mainnet.optimism.io"],
      blockExplorerUrls: ["https://optimistic.etherscan.io"],
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11"
    },
    {
      key: "linea",
      name: "Linea",
      chainId: 59144,
      rpcUrls: ["https://rpc.linea.build"],
      blockExplorerUrls: ["https://lineascan.build"],
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11"
    },
    {
      key: "sonic",
      name: "Sonic",
      chainId: 146,
      rpcUrls: ["https://rpc.soniclabs.com"],
      blockExplorerUrls: ["https://sonicscan.org"],
      nativeCurrency: { name: "Sonic", symbol: "S", decimals: 18 },
      multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11"
    },
    {
      key: "berachain",
      name: "Berachain",
      chainId: 80094,
      rpcUrls: ["https://rpc.berachain.com"],
      blockExplorerUrls: ["https://berascan.com"],
      nativeCurrency: { name: "BERA", symbol: "BERA", decimals: 18 },
      multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11"
    },
    {
      key: "mantle",
      name: "Mantle",
      chainId: 5000,
      rpcUrls: ["https://rpc.mantle.xyz"],
      blockExplorerUrls: ["https://mantlescan.xyz"],
      nativeCurrency: { name: "Mantle", symbol: "MNT", decimals: 18 },
      multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11"
    },
    {
      key: "binancechain",
      name: "BNB Smart Chain",
      chainId: 56,
      rpcUrls: ["https://bsc-dataseed.bnbchain.org"],
      blockExplorerUrls: ["https://bscscan.com"],
      nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
      multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11"
    },
    {
      key: "monad",
      name: "Monad",
      chainId: 143,
      rpcUrls: ["https://rpc.monad.xyz"],
      blockExplorerUrls: ["https://monadscan.com"],
      nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
      multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11"
    },
    {
      key: "zksync",
      name: "ZKsync",
      chainId: 324,
      rpcUrls: ["https://zksync-era.blockpi.network/v1/rpc/public"],
      blockExplorerUrls: ["https://explorer.zksync.io"],
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11"
    },    
    {
      key: "polygon",
      name: "Polygon",
      chainId: 137,
      rpcUrls: [],
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
      label: "Send the full detected balance of each selected token to one recipient",
      supportsNative: true,
      supportsErc20: true
    },
    permit_batch_signer: {
      label: "Approve the full detected balance of each selected token to one contract",
      supportsNative: false,
      supportsErc20: true
    }
  }
};
