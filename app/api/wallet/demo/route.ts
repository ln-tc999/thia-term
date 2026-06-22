export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth-config'
import { prisma } from '@/lib/prisma'
import { generateDemoWallet, generateDemoT3nDid, generateDemoEmail } from '@/lib/demo-wallet'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/wallet/demo
 * Generate a demo wallet with T3N DID for testing
 */
export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id

  try {
    // Check if user already has a wallet
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { walletAddress: true },
    })

    if (user?.walletAddress) {
      return NextResponse.json(
        { error: 'Wallet already exists. Cannot create demo wallet.' },
        { status: 400 }
      )
    }

    // Generate demo wallet
    const {
      walletAddress,
      encryptedMnemonic,
      encryptedPrivateKey,
    } = generateDemoWallet()

    // Generate T3N DID from wallet address
    const t3nDid = generateDemoT3nDid(walletAddress)

    // Update user with demo wallet
    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        walletAddress,
        t3nDid,
        encryptedMnemonic,
        encryptedPrivateKey,
        walletType: 'managed',
        // TODO: Re-enable isDemo after migration deployed to production
        // isDemo: true,
      },
    })

    // Audit log
    await logAudit({
      userId,
      action: 'wallet.demo.created',
      entityType: 'Wallet',
      entityId: walletAddress,
      metadata: {
        walletAddress,
        t3nDid,
        walletType: 'managed',
      },
    })

    return NextResponse.json({
      success: true,
      wallet: {
        address: updated.walletAddress,
        t3nDid: updated.t3nDid,
        type: updated.walletType,
        isDemo: true,
      },
      message: 'Demo wallet created successfully! 🎉',
      note: 'This is a test wallet. Do not send real funds.',
    })
  } catch (error) {
    console.error('Demo wallet creation error:', error)
    return NextResponse.json(
      { error: 'Failed to create demo wallet' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/wallet/demo
 * Remove demo wallet (allows creating a real one)
 */
export async function DELETE() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { walletAddress: true, walletType: true },
    })

    // TODO: Re-enable demo check after isDemo migration deployed
    // For now, allow deletion if wallet type is 'managed'
    if (!user?.walletType || user.walletType !== 'managed') {
      return NextResponse.json(
        { error: 'Not a demo wallet. Cannot delete.' },
        { status: 400 }
      )
    }

    // Remove wallet credentials
    await prisma.user.update({
      where: { id: userId },
      data: {
        walletAddress: null,
        t3nDid: null,
        encryptedMnemonic: null,
        encryptedPrivateKey: null,
        walletType: null,
        // TODO: Re-enable after migration
        // isDemo: false,
      },
    })

    await logAudit({
      userId,
      action: 'wallet.demo.deleted',
      entityType: 'Wallet',
      entityId: user.walletAddress ?? 'unknown',
      metadata: { previousAddress: user.walletAddress },
    })

    return NextResponse.json({
      success: true,
      message: 'Demo wallet removed successfully',
    })
  } catch (error) {
    console.error('Demo wallet deletion error:', error)
    return NextResponse.json(
      { error: 'Failed to delete demo wallet' },
      { status: 500 }
    )
  }
}
