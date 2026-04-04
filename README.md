Minimal, static web pages.

## Features

- **Batch Transfers**: Send many token transfers across hundreds of tokens on EVM chains; fast.

## Local Build

- Install dependencies with `npm install`
- Edit `src/batch-transfer/`
- Build the browser bundle with `npm run build`
- Deploy the generated `batch-transfer/app.js` with the static site files

## Deployment

This is a static site that can be deployed to any web server:

### Contents

- `index.html` - Main page
- `batch-transfer/` - Batch transfer page assets
- `src/batch-transfer/` - Batch transfer source files
- `tokens.enriched.json` - Token catalog data
- `banner.webp` - Site banner image

## Security Notes

- All operations happen client-side
- Private key support intended for offline use
- Uses extension wallet for production signing
- No data collection or tracking
