// Fetch the faucet frontend to inspect the JS bundles
const res = await fetch('https://faucet.hashkeychain.net/')
const html = await res.text()
// Extract script src tags
const scripts = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1])
console.log('Scripts found:', scripts.slice(0, 10))
// Also look for any inline references to signature, auth, etc
const lines = html.split('\n').filter(l => /signature|timestamp|username|github|auth|sign/i.test(l))
console.log('Relevant HTML lines:', lines.slice(0, 20))
