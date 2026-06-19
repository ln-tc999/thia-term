import { useEffect, useState } from 'react'
import { useAccount, useConnect, useDisconnect, useBalance, useChainId } from 'wagmi'
import { useToast } from '@/hooks/use-toast'

export function useWalletConnection() {
  const { address, isConnected, isConnecting } = useAccount()
  const { connect, connectors, error: connectError } = useConnect()
  const { disconnect } = useDisconnect()
  const { data: balance } = useBalance({ address })
  const chainId = useChainId()
  const { toast } = useToast()
  const [isConnectingWallet, setIsConnectingWallet] = useState(false)

  useEffect(() => {
    if (connectError) {
      toast({
        title: "Connection Failed",
        description: connectError.message,
        variant: "destructive",
      })
      setIsConnectingWallet(false)
    }
  }, [connectError, toast])

  const connectToWallet = async (connectorId: string) => {
    try {
      setIsConnectingWallet(true)
      const connector = connectors.find(c => c.id === connectorId)
      if (connector) {
        await connect({ connector })
        toast({
          title: "Wallet Connected",
          description: "Your wallet has been successfully connected.",
        })
      }
    } catch (error) {
      console.error('Wallet connection error:', error)
      toast({
        title: "Connection Failed",
        description: "Failed to connect wallet. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsConnectingWallet(false)
    }
  }

  const disconnectFromWallet = async () => {
    try {
      await disconnect()
      toast({
        title: "Wallet Disconnected",
        description: "Your wallet has been disconnected.",
      })
    } catch (error) {
      console.error('Wallet disconnection error:', error)
      toast({
        title: "Disconnection Failed",
        description: "Failed to disconnect wallet. Please try again.",
        variant: "destructive",
      })
    }
  }

  const getWalletDisplayName = () => {
    if (!address) return 'Not Connected'
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  const getBalanceDisplay = () => {
    if (!balance) return '0.00'
    return parseFloat(balance.formatted).toFixed(4)
  }

  const getChainName = () => {
    const chainNames: { [key: number]: string } = {
      1: 'Ethereum',
      137: 'Polygon',
      42161: 'Arbitrum',
      10: 'Optimism',
      11155111: 'Sepolia',
      80001: 'Mumbai',
      133: 'HashKey Testnet',
      230315: 'HashKey Chain',
    }
    return chainNames[chainId] || `Chain ${chainId}`
  }

  return {
    isConnected,
    isConnecting: isConnecting || isConnectingWallet,
    address,
    chainId,
    balance,
    walletDisplayName: getWalletDisplayName(),
    balanceDisplay: getBalanceDisplay(),
    chainName: getChainName(),
    connectors,
    connectToWallet,
    disconnectFromWallet,
    error: connectError,
  }
}
