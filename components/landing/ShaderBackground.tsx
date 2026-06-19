"use client"

import { useEffect, useRef } from "react"

export function ShaderBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const cv = canvas
    const cx = ctx

    let width = window.innerWidth
    let height = window.innerHeight
    cv.width = width
    cv.height = height

    const isMobile = width < 768
    // Fewer, smaller particles on mobile for performance
    const particleCount = isMobile ? 60 : 130

    const mouse = { x: -9999, y: -9999 }
    let animId: number
    let time = 0

    const particles: {
      x: number; y: number
      vx: number; vy: number
      size: number; alpha: number
    }[] = []

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        // Small — max ~2px core
        size: Math.random() * 1.2 + 0.4,
        alpha: Math.random() * 0.45 + 0.25,
      })
    }

    function noise(x: number, y: number, t: number) {
      return (
        Math.sin(x * 0.012 + t) * Math.cos(y * 0.012 + t * 0.7) +
        Math.sin(x * 0.025 - t * 0.5) * Math.cos(y * 0.018 + t * 0.3) * 0.5
      )
    }

    window.addEventListener("mousemove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY })
    window.addEventListener("resize", () => {
      width = window.innerWidth
      height = window.innerHeight
      cv.width = width
      cv.height = height
    })

    function draw() {
      time += 0.002
      cx.clearRect(0, 0, width, height)

      // Subtle connection lines on desktop only
      if (!isMobile) {
        for (let i = 0; i < particles.length; i++) {
          for (let j = i + 1; j < particles.length; j++) {
            const a = particles[i], b = particles[j]
            const dx = a.x - b.x, dy = a.y - b.y
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist < 90) {
              cx.beginPath()
              cx.moveTo(a.x, a.y)
              cx.lineTo(b.x, b.y)
              cx.strokeStyle = `rgba(52,211,153,${(1 - dist / 90) * 0.08})`
              cx.lineWidth = 0.5
              cx.stroke()
            }
          }
        }
      }

      for (const p of particles) {
        const n = noise(p.x, p.y, time)
        const angle = n * Math.PI * 2
        p.vx += Math.cos(angle) * 0.008
        p.vy += Math.sin(angle) * 0.008

        // Gentle mouse attraction
        const dx = mouse.x - p.x, dy = mouse.y - p.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 200 && dist > 0) {
          const force = (200 - dist) / 200
          p.vx += (dx / dist) * force * 0.06
          p.vy += (dy / dist) * force * 0.06
        }

        p.vx *= 0.97
        p.vy *= 0.97
        p.x += p.vx
        p.y += p.vy

        if (p.x < 0) p.x = width
        if (p.x > width) p.x = 0
        if (p.y < 0) p.y = height
        if (p.y > height) p.y = 0

        // Small tight glow (radius = size * 3.5 max ~5.6px)
        const glowR = p.size * 3.5
        const grad = cx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR)
        grad.addColorStop(0, `rgba(52,211,153,${p.alpha * 0.7})`)
        grad.addColorStop(1, "rgba(52,211,153,0)")
        cx.beginPath()
        cx.arc(p.x, p.y, glowR, 0, Math.PI * 2)
        cx.fillStyle = grad
        cx.fill()

        // Bright 1-2px core dot
        cx.beginPath()
        cx.arc(p.x, p.y, p.size * 0.5, 0, Math.PI * 2)
        cx.fillStyle = `rgba(167,243,208,${p.alpha})`
        cx.fill()
      }

      animId = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(animId)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-[11]"
      style={{ opacity: 0.5 }}
    />
  )
}
