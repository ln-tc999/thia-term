import { useState, useEffect } from 'react'

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  total?: number
  limit?: number
  offset?: number
}

export interface ApiError {
  message: string
  status?: number
}

export function useApi<T>(
  endpoint: string,
  options: RequestInit = {},
  dependencies: any[] = []
) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        setError(null)

        const response = await fetch(endpoint, {
          headers: {
            'Content-Type': 'application/json',
            ...options.headers,
          },
          ...options,
        })

        const result: ApiResponse<T> = await response.json()

        if (!response.ok) {
          throw new Error(result.error || 'API request failed')
        }

        if (result.success) {
          setData(result.data || null)
        } else {
          throw new Error(result.error || 'API request failed')
        }
      } catch (err) {
        setError({
          message: err instanceof Error ? err.message : 'Unknown error occurred',
          status: err instanceof Error && 'status' in err ? (err as any).status : undefined
        })
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, dependencies)

  const refetch = () => {
    setLoading(true)
    setError(null)
    setData(null)
  }

  return { data, loading, error, refetch }
}

// Specific hooks for different data types
export function usePaymentLinks(status?: string) {
  const params = new URLSearchParams()
  if (status) params.append('status', status)

  const endpoint = `/api/payment-links${params.toString() ? `?${params.toString()}` : ''}`

  return useApi<any[]>(endpoint, {}, [status])
}

export function usePayments(linkId?: string, status?: string, limit = 50, offset = 0) {
  const params = new URLSearchParams()
  if (linkId) params.append('linkId', linkId)
  if (status) params.append('status', status)
  params.append('limit', limit.toString())
  params.append('offset', offset.toString())

  const endpoint = `/api/payments?${params.toString()}`

  return useApi<any[]>(endpoint, {}, [linkId, status, limit, offset])
}

export function useVaults(status?: string) {
  const params = new URLSearchParams()
  if (status) params.append('status', status)

  const endpoint = `/api/vaults${params.toString() ? `?${params.toString()}` : ''}`

  return useApi<any[]>(endpoint, {}, [status])
}

export function usePayrollBatches(status?: string, includeRecipients = false) {
  const params = new URLSearchParams()
  if (status) params.append('status', status)
  if (includeRecipients) params.append('includeRecipients', 'true')

  const endpoint = `/api/payroll${params.toString() ? `?${params.toString()}` : ''}`

  return useApi<any[]>(endpoint, {}, [status, includeRecipients])
}

// Mutation hooks
export function useCreatePaymentLink() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const createLink = async (data: any) => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/payment-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create payment link')
      }

      return result.data
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : 'Unknown error occurred' })
      throw err
    } finally {
      setLoading(false)
    }
  }

  return { createLink, loading, error }
}

export function useCreateVault() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const createVault = async (data: any) => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/vaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create vault')
      }

      return result.data
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : 'Unknown error occurred' })
      throw err
    } finally {
      setLoading(false)
    }
  }

  return { createVault, loading, error }
}

export function useCreatePayrollBatch() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const createBatch = async (data: any) => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/payroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create payroll batch')
      }

      return result.data
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : 'Unknown error occurred' })
      throw err
    } finally {
      setLoading(false)
    }
  }

  return { createBatch, loading, error }
}
