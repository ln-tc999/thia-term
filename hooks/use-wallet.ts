export function useWalletConnection() {
  return {
    isConnected: false,
    isConnecting: false,
    address: null,
    chainId: null,
    balance: null,
    walletDisplayName: 'Not Connected',
    balanceDisplay: '0.00',
    chainName: 'Unknown',
    connectors: [],
    connectToWallet: async () => {},
    disconnectFromWallet: async () => {},
    error: null,
  }
}
