Minimal, static web pages.

## Features

- **Batch Transfers**: Send 1400+ ERC tokens across 13 chains. Never paste your private key online.
- **Pendle Interface**: Filter pendle markets; offers unique support for SY tokens.

## Local Build

- Install dependencies with `npm install`
- Edit `src/...`
- Build the browser bundle with `npm run build`
- Deploy the generated `path/to/app.js` with the static site files

## Deployment

This is a static site that can be deployed to any web server:

### Contents

- `index.html` - Main page
- `batch-transfer/` - Batch transfer page assets
- `pendle/` - Pendle interface page assets
- `src/batch-transfer/` - Batch transfer source files
- `src/pendle/` - Pendle interface source files
- `src/tokens.enriched.json` - Token data
- `src/pendle.json` - Pendle data

## Security Notes

- All operations happen client-side
- Private key support intended for offline use
- Uses extension wallet for production signing
- No data collection or tracking
