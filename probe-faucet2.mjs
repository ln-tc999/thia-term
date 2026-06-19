// Fetch the faucet page JS to find signing logic
const res = await fetch('https://faucet.hashkeychain.net/_next/static/chunks/app/%5Blocale%5D/(root)/faucet/page-47328b401d418e1e.js')
const js = await res.text()
// Search for signature/hmac/sign related code
const lines = js.split(';').filter(l => /hmac|signature|X-Sig|username|timestamp|sign|crypto/i.test(l))
console.log('Relevant segments:')
lines.slice(0, 30).forEach(l => console.log(l.trim().slice(0, 200)))
