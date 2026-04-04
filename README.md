Minimal, static web pages.

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
