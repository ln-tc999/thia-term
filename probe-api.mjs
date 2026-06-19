const paths = ['/api/auth', '/api/auth/login', '/api/user', '/api/nonce', '/api/faucet', '/api/faucet/claim', '/api/faucet/request', '/api/github', '/api/login']
const base = 'https://faucet-api.hashkeychain.net'
for (const path of paths) {
  const r = await fetch(base + path)
  console.log(r.status, path)
}
