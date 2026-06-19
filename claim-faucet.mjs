import { createHmac } from 'crypto'

const HMAC_USERNAME = 'faucet'
const HMAC_SECRET = 'dce7OzR8GyYd'
const ADDRESS = '0xac5E3fd8772bb03d7cc83421D13C942735f74506'
const METHOD = 'POST'
const PATH = '/api/faucet/drip'

const date = new Date().toUTCString()
const message = `x-date: ${date}\n${METHOD} ${PATH} HTTP/1.1`
const hmac = createHmac('sha256', HMAC_SECRET).update(message).digest('base64')
const signature = `hmac username="${HMAC_USERNAME}", algorithm="hmac-sha256", headers="x-date request-line", signature="${hmac}"`

console.log('Date:', date)
console.log('Message:', message)
console.log('Signature:', signature)

const res = await fetch(`https://faucet-api.hashkeychain.net${PATH}`, {
  method: METHOD,
  headers: {
    'Content-Type': 'application/json',
    'X-Signature': signature,
    'X-Timestamp': date,
  },
  body: JSON.stringify({ address: ADDRESS })
})

let data; try { data = await res.json() } catch { data = await res.text() }
console.log(`\nStatus: ${res.status}`)
console.log('Response:', JSON.stringify(data, null, 2))

if (res.ok || data?.txHash || data?.hash || data?.tx) {
  console.log('\nSUCCESS! TX Hash:', data.txHash || data.hash || data.tx || data)
}
