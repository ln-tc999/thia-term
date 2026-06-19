# WalletConnect Setup Guide

## Getting a WalletConnect Project ID

To enable wallet connectivity in FlowLink, you need to get a WalletConnect Project ID:

### 1. Create WalletConnect Account
1. Go to [WalletConnect Cloud](https://cloud.walletconnect.com/)
2. Sign up for a free account
3. Create a new project

### 2. Get Your Project ID
1. In your WalletConnect Cloud dashboard
2. Copy your Project ID (it looks like: `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`)
3. Add it to your environment variables

### 3. Environment Variables

#### For Local Development
Add to your `.env.local` file:
```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id_here
```

#### For Production (Vercel)
1. Go to your Vercel dashboard
2. Select your FlowLink project
3. Go to Settings > Environment Variables
4. Add:
   - **Name**: `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
   - **Value**: `your_project_id_here`
   - **Environment**: Production, Preview, Development

### 4. Supported Wallets

FlowLink supports all major wallets through WalletConnect:

#### Browser Wallets
- MetaMask
- Coinbase Wallet
- Brave Wallet
- Trust Wallet
- Rainbow Wallet

#### Mobile Wallets
- WalletConnect (QR Code)
- MetaMask Mobile
- Trust Wallet Mobile
- Rainbow Mobile
- Coinbase Wallet Mobile

#### Hardware Wallets
- Ledger (via MetaMask)
- Trezor (via MetaMask)

### 5. Supported Networks

FlowLink supports multiple blockchain networks:

#### Mainnets
- **Ethereum** (Chain ID: 1)
- **Polygon** (Chain ID: 137) - Default
- **Arbitrum** (Chain ID: 42161)
- **Optimism** (Chain ID: 10)

#### Testnets
- **Sepolia** (Chain ID: 11155111)
- **Polygon Mumbai** (Chain ID: 80001)

#### HashKey Networks
- **HashKey Chain** (Chain ID: 230315)
- **HashKey Testnet** (Chain ID: 230315)

### 6. Features

#### Wallet Connection
- One-click wallet connection
- Multiple wallet support
- Network switching
- Balance display
- Transaction history

#### Security Features
- Address verification
- Network validation
- Transaction signing
- Secure key management

#### User Experience
- Responsive design
- Loading states
- Error handling
- Success notifications
- Disconnect functionality

### 7. Testing

#### Test with MetaMask
1. Install MetaMask browser extension
2. Create or import a test account
3. Switch to Polygon Mumbai testnet
4. Get test MATIC from [Polygon Faucet](https://faucet.polygon.technology/)
5. Connect wallet in FlowLink

#### Test with Mobile Wallet
1. Use WalletConnect QR code
2. Scan with mobile wallet app
3. Approve connection
4. Test transactions

### 8. Troubleshooting

#### Common Issues

**Wallet Not Connecting**
- Check if WalletConnect Project ID is set
- Ensure wallet extension is installed
- Try refreshing the page
- Check browser console for errors

**Wrong Network**
- Switch to supported network (Polygon recommended)
- Use network switcher in wallet
- Check chain ID in wallet

**Transaction Failed**
- Ensure sufficient balance for gas
- Check network congestion
- Verify transaction parameters
- Try increasing gas limit

#### Debug Mode
Enable debug mode by adding to `.env.local`:
```bash
NEXT_PUBLIC_WAGMI_DEBUG=true
```

### 9. Production Checklist

Before deploying to production:

- [ ] WalletConnect Project ID configured
- [ ] Environment variables set in Vercel
- [ ] Test wallet connections on all supported networks
- [ ] Verify transaction flows work correctly
- [ ] Test mobile wallet connections
- [ ] Check error handling and user feedback
- [ ] Validate security measures
- [ ] Test with real funds (small amounts)

### 10. Support

For wallet connection issues:
- Check [WalletConnect Documentation](https://docs.walletconnect.com/)
- Review [RainbowKit Documentation](https://www.rainbowkit.com/)
- Check [Wagmi Documentation](https://wagmi.sh/)

For FlowLink-specific issues:
- Check browser console for errors
- Verify environment variables
- Test with different wallets
- Contact FlowLink support
