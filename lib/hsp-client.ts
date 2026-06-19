import crypto from 'crypto'

export interface SinglePayParams {
  merchant_order_id: string
  amount: string
  token: 'USDC' | 'USDT' | 'HSK'
  chain_id: number
  webhook_url: string
  redirect_url: string
  expire_time?: number
  description?: string
}

export interface MultiPayParams {
  merchant_order_id: string
  description?: string
  webhook_url: string
  redirect_url: string
  expire_time?: number
}

export interface CartMandateResponse {
  code: string
  message: string
  data: {
    cart_mandate_id: string
    checkout_url: string
    status: string
    expire_time: number
    created_at: number
  }
}

export interface PaymentStatus {
  code: string
  message: string
  data: {
    cart_mandate_id: string
    status: string
    payments: HSPPayment[]
  }
}

export interface HSPPayment {
  payment_request_id: string
  cart_mandate_id: string
  amount: string
  token: string
  chain_id: number
  status: 'PENDING' | 'SUCCESS' | 'FAILED'
  tx_hash?: string
  created_at: number
}

export interface ChainConfig {
  code: string
  message: string
  data: {
    chains: HSPChain[]
  }
}

export interface HSPChain {
  chain_id: number
  name: string
  tokens: HSPToken[]
}

export interface HSPToken {
  symbol: string
  address: string
  decimals: number
}

export interface HSPWebhookPayload {
  cart_mandate_id: string
  payment_request_id: string
  status: 'SUCCESS' | 'FAILED' | 'PENDING'
  amount: string
  token: string
  tx_hash?: string
  chain_id: number
  created_at: number
}

class HSPClient {
  private appKey: string
  private appSecret: string
  private baseUrl: string
  private ready: boolean

  constructor(appKey?: string, appSecret?: string, baseUrl?: string) {
    this.appKey = appKey || ''
    this.appSecret = appSecret || ''
    this.baseUrl = baseUrl || 'https://api.hsp.hashkey.com'
    this.ready = !!(appKey && appSecret)

    if (!this.ready) {
      console.warn('[HSP] credentials not configured — HSP features disabled')
    }
  }

  get isConfigured(): boolean {
    return this.ready
  }

  private buildSignature(
    method: string,
    path: string,
    query: string,
    body: string,
    timestamp: string,
    nonce: string,
  ): string {
    const bodyHash = crypto.createHash('sha256').update(body).digest('hex')
    const message = `${method}\n${path}\n${query}\n${bodyHash}\n${timestamp}\n${nonce}`
    return crypto.createHmac('sha256', this.appSecret).update(message).digest('hex')
  }

  private buildHeaders(method: string, path: string, query: string, body: string): Record<string, string> {
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const nonce = crypto.randomBytes(16).toString('hex')
    const signature = this.buildSignature(method, path, query, body, timestamp, nonce)
    return {
      'Content-Type': 'application/json',
      'X-App-Key': this.appKey,
      'X-Signature': signature,
      'X-Timestamp': timestamp,
      'X-Nonce': nonce,
    }
  }

  private async request<T>(
    method: string,
    path: string,
    params?: Record<string, string>,
    body?: unknown,
  ): Promise<T | null> {
    if (!this.ready) return null

    const query = params ? new URLSearchParams(params).toString() : ''
    const bodyStr = body ? JSON.stringify(body) : ''
    const url = `${this.baseUrl}${path}${query ? `?${query}` : ''}`
    const headers = this.buildHeaders(method.toUpperCase(), path, query, bodyStr)

    const res = await fetch(url, { method, headers, body: bodyStr || undefined })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`HSP API error ${res.status}: ${text}`)
    }

    return res.json() as Promise<T>
  }

  async createSinglePayMandate(params: SinglePayParams): Promise<CartMandateResponse | null> {
    const defaultExpiry = Math.floor(Date.now() / 1000) + 2 * 60 * 60
    return this.request<CartMandateResponse>('POST', '/api/v1/public/cartmandate', undefined, {
      ...params,
      expire_time: params.expire_time ?? defaultExpiry,
    })
  }

  async createMultiPayMandate(params: MultiPayParams): Promise<CartMandateResponse | null> {
    const defaultExpiry = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
    return this.request<CartMandateResponse>('POST', '/api/v1/public/cart-mandate/multipay', undefined, {
      ...params,
      expire_time: params.expire_time ?? defaultExpiry,
    })
  }

  async getPaymentStatus(cartMandateId: string): Promise<PaymentStatus | null> {
    return this.request<PaymentStatus>('GET', '/api/v1/public/payments/cart-mandate', {
      cart_mandate_id: cartMandateId,
    })
  }

  async queryByPaymentRequestId(paymentRequestId: string): Promise<HSPPayment | null> {
    const result = await this.request<{ code: string; data: HSPPayment }>(
      'GET',
      '/api/v1/public/payments/cart-mandate',
      { payment_request_id: paymentRequestId },
    )
    return result?.data ?? null
  }

  async getChainConfig(): Promise<ChainConfig | null> {
    return this.request<ChainConfig>('GET', '/api/v1/payment/chain-config')
  }

  verifyWebhookSignature(
    method: string,
    path: string,
    query: string,
    body: string,
    timestamp: string,
    nonce: string,
    receivedSignature: string,
  ): boolean {
    if (!this.ready) return false
    try {
      const expected = this.buildSignature(method, path, query, body, timestamp, nonce)
      const a = Buffer.from(expected.toLowerCase(), 'hex')
      const b = Buffer.from(receivedSignature.toLowerCase(), 'hex')
      if (a.length !== b.length) return false
      return crypto.timingSafeEqual(a, b)
    } catch {
      return false
    }
  }
}

export const hspClient = new HSPClient(
  process.env.HSP_APP_KEY,
  process.env.HSP_APP_SECRET,
  process.env.HSP_BASE_URL,
)
