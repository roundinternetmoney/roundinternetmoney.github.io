# Round Internet Money

A minimal, static web application for decentralized finance operations, emphasizing trustless and austere principles. Finance must be made decentralized, trustless, and austere.

## Features

- **Wallet Batch Transfers**: Connect your extension wallet and perform batch token transfers across multiple EVM chains
- **Multi-Chain Support**: Ethereum, Base, Arbitrum, Polygon, and HyperEVM
- **Token Balance Scanning**: Automatically detect and scan ERC-20 token balances
- **Execution Strategies**: 
  - Sequential direct transactions
  - Permit-based approvals for batch signers
- **Debug Mode**: Private key testing for localhost development
- **Static Deployment**: No server-side components required

## Quick Start

1. Visit the [main site](https://roundinternet.money)
2. Click "wallet connect batch transfers"
3. Connect your wallet extension
4. Select a chain and scan balances
5. Choose execution strategy and execute transfers

## Supported Chains

- Ethereum Mainnet
- Base
- Arbitrum One
- Polygon
- HyperEVM

## Usage

### For Users

1. **Connect Wallet**: Click "Connect wallet" to link your extension wallet
2. **Select Chain**: Choose the blockchain network
3. **Scan Balances**: Click "Scan balances" to detect token holdings
4. **Configure Transfer**:
   - Choose execution strategy (sequential or permit-based)
   - Set recipient address or approval target
   - Select tokens to transfer
5. **Execute**: Click "Execute" to perform the batch operation

### Debug Mode (Localhost Only)

For development testing:
1. Enable "show debug" checkbox
2. Enter a private key in the debug panel
3. Use "Debug private key via browser RPC" mode

**Warning**: Private key mode is for localhost testing only. Never use real keys in production.

## Deployment

This is a static site that can be deployed to any web server:

### Files Required

- `index.html` - Main landing page
- `batch-transfer.html` - Batch transfer interface
- `batch-transfer-app.js` - Application logic
- `tokens.enriched.json` - Token catalog data
- `banner.webp` - Site banner image

### cPanel Deployment

1. Upload all files to `public_html/` directory
2. Ensure `tokens.enriched.json` is accessible
3. Configure domain to point to the hosting

### Local Development

```bash
# Serve locally
python -m http.server 8000
# Visit http://localhost:8000
```

## Architecture

- **Frontend**: Vanilla JavaScript with Ethers.js v6
- **Data**: Static JSON files for token catalogs
- **RPC**: Chainlist.org integration with fallback URLs
- **Execution**: Client-side transaction building and signing

## Security Notes

- All operations happen client-side
- Private keys remain in the wallet extension (debug mode allows direct browser entry for testing)
- Uses extension wallet for production signing
- No data collection or tracking

## Contributing

This project emphasizes minimalism and trustlessness. Contributions should maintain these principles.

## Integrations

- EVM Chains
- Web3 Services
- Web2 Services
- Unix tooling
- Golang
- NATS
- Grafana
- Protobuf

## Contact

[contact@roundinternet.money](mailto:contact@roundinternet.money)

---

*"Don't be evil"* - Web Archive Reference</content>
<parameter name="newString"># Round Internet Money

A minimal, static web application for decentralized finance operations, emphasizing trustless and austere principles. Finance must be made decentralized, trustless, and austere.

## Features

- **Wallet Batch Transfers**: Connect your extension wallet and perform batch token transfers across multiple EVM chains
- **Multi-Chain Support**: Ethereum, Base, Arbitrum, Polygon, and HyperEVM
- **Token Balance Scanning**: Automatically detect and scan ERC-20 token balances
- **Execution Strategies**: 
  - Sequential direct transactions
  - Permit-based approvals for batch signers
- **Debug Mode**: Private key testing for localhost development
- **Static Deployment**: No server-side components required

## Quick Start

1. Visit the [main site](https://roundinternet.money)
2. Click "wallet connect batch transfers"
3. Connect your wallet extension
4. Select a chain and scan balances
5. Choose execution strategy and execute transfers

## Supported Chains

- Ethereum Mainnet
- Base
- Arbitrum One
- Polygon
- HyperEVM

## Usage

### For Users

1. **Connect Wallet**: Click "Connect wallet" to link your extension wallet
2. **Select Chain**: Choose the blockchain network
3. **Scan Balances**: Click "Scan balances" to detect token holdings
4. **Configure Transfer**:
   - Choose execution strategy (sequential or permit-based)
   - Set recipient address or approval target
   - Select tokens to transfer
5. **Execute**: Click "Execute" to perform the batch operation

### Debug Mode (Localhost Only)

For development testing:
1. Enable "show debug" checkbox
2. Enter a private key in the debug panel
3. Use "Debug private key via browser RPC" mode

**Warning**: Private key mode is for localhost testing only. Never use real keys in production.

## Deployment

This is a static site that can be deployed to any web server:

### Files Required

- `index.html` - Main landing page
- `batch-transfer.html` - Batch transfer interface
- `batch-transfer-app.js` - Application logic
- `tokens.enriched.json` - Token catalog data
- `banner.webp` - Site banner image

### cPanel Deployment

1. Upload all files to `public_html/` directory
2. Ensure `tokens.enriched.json` is accessible
3. Configure domain to point to the hosting

### Local Development

```bash
# Serve locally
python -m http.server 8000
# Visit http://localhost:8000
```

## Architecture

- **Frontend**: Vanilla JavaScript with Ethers.js v6
- **Data**: Static JSON files for token catalogs
- **RPC**: Chainlist.org integration with fallback URLs
- **Execution**: Client-side transaction building and signing

## Security Notes

- All operations happen client-side
- Private keys remain in the wallet extension (debug mode allows direct browser entry for testing)
- Uses extension wallet for production signing
- No data collection or tracking

## Contributing

This project emphasizes minimalism and trustlessness. Contributions should maintain these principles.

## Integrations

- EVM Chains
- Web3 Services
- Web2 Services
- Unix tooling
- Golang
- NATS
- Grafana
- Protobuf

## Contact

[contact@roundinternet.money](mailto:contact@roundinternet.money)

---

*"Don't be evil"* - Web Archive Reference</content>
<parameter name="oldString"># Round Internet Money

A minimal, static web pages.

## Features

- **Batch Transfers**: Send many token transfers across hundreds of tokens on EVM chains; fast.

## Deployment

This is a static site that can be deployed to any web server:

### Contents

- `index.html` - Main page
- `batch-transfer.html` - Batch transfer interface
- `batch-transfer-app.js` - Application logic
- `tokens.enriched.json` - Token catalog data
- `banner.webp` - Site banner image

## Security Notes

- All operations happen client-side
- Private key support intended for offline use
- Uses extension wallet for production signing
- No data collection or tracking
