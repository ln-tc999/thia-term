'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { 
  Send, 
  Bot, 
  User, 
  Loader2, 
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Sparkles,
  X,
  Move,
  Brain,
  Zap
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

interface AiChatProps {
  className?: string
}

export default function AiChat({ className }: AiChatProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [showWelcomePopup, setShowWelcomePopup] = useState(false)
  const [position, setPosition] = useState({ x: 24, y: 300 })
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hello! I\'m your FlowLink AI assistant. I can help you with crypto payments, compliance questions, and platform features. How can I assist you today?',
      timestamp: new Date()
    }
  ])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const iconRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    // Initialize position after component mounts
    if (typeof window !== 'undefined') {
      setPosition({ x: 24, y: window.innerHeight / 2 - 28 })
    }
  }, [])

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
      // Show welcome popup after a short delay
      setTimeout(() => {
        setShowWelcomePopup(true)
      }, 500)
      
      // Auto-hide popup after 4 seconds
      const hideTimer = setTimeout(() => {
        setShowWelcomePopup(false)
      }, 4000)
      
      return () => clearTimeout(hideTimer)
    } else {
      setShowWelcomePopup(false)
    }
  }, [isOpen])

  // Drag functionality
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target !== iconRef.current && !iconRef.current?.contains(e.target as Node)) {
      return
    }
    setIsDragging(true)
    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    })
  }

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging) return
    
    const newX = e.clientX - dragStart.x
    const newY = e.clientY - dragStart.y
    
    // Keep within viewport bounds
    const maxX = (typeof window !== 'undefined' ? window.innerWidth : 1200) - 56 // 56px is button width
    const maxY = (typeof window !== 'undefined' ? window.innerHeight : 800) - 56 // 56px is button height
    
    setPosition({
      x: Math.max(0, Math.min(newX, maxX)),
      y: Math.max(0, Math.min(newY, maxY))
    })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, dragStart])

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInputValue('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage.content,
          history: messages.slice(-10) // Send last 10 messages for context
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to get AI response')
      }

      const data = await response.json()
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.message,
        timestamp: new Date()
      }

      setMessages(prev => [...prev, assistantMessage])
    } catch (error) {
      console.error('Error sending message:', error)
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <>
      {/* Draggable Chat Icon */}
      {!isOpen && (
        <div 
          ref={iconRef}
          className={cn("fixed z-50 cursor-move", className)}
          style={{
            left: `${position.x}px`,
            top: `${position.y}px`,
            transform: isDragging ? 'scale(1.1)' : 'scale(1)',
            transition: isDragging ? 'none' : 'transform 0.2s ease-out'
          }}
          onMouseDown={handleMouseDown}
        >
          <div className="relative group">
            {/* Pulsing glow effect */}
            <div className="absolute -inset-2 bg-gradient-to-r from-emerald-500/30 to-green-500/30 rounded-full blur-lg animate-pulse opacity-60"></div>
            
            {/* Main button */}
            <Button
              onClick={() => setIsOpen(true)}
              className={cn(
                "h-14 w-14 rounded-full bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 shadow-lg hover:shadow-xl transition-all duration-300 relative overflow-hidden",
                isDragging && "shadow-2xl"
              )}
            >
              {/* Animated background */}
              <div className="absolute inset-0 bg-gradient-to-r from-emerald-400/20 to-green-400/20 animate-pulse"></div>
              
              {/* AI Assistant Icon */}
              <div className="relative z-10 flex items-center justify-center">
                {/* Brain icon as main AI symbol */}
                <Brain className={cn(
                  "h-5 w-5 text-white transition-transform duration-300",
                  "group-hover:scale-110 group-hover:rotate-12"
                )} />
                
                {/* Sparkles around the brain */}
                <Sparkles className={cn(
                  "absolute -top-1 -right-1 h-3 w-3 text-emerald-200 animate-pulse",
                  "group-hover:animate-spin"
                )} />
                <Sparkles className={cn(
                  "absolute -bottom-1 -left-1 h-2 w-2 text-green-200 animate-pulse delay-500",
                  "group-hover:animate-bounce"
                )} />
              </div>
              
              {/* Drag indicator */}
              <div className="absolute -bottom-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <Move className="h-3 w-3 text-emerald-200" />
              </div>
            </Button>
            
            {/* Floating particles */}
            <div className="absolute -top-2 -left-2 w-1 h-1 bg-emerald-400 rounded-full animate-ping opacity-60"></div>
            <div className="absolute -bottom-2 -right-2 w-1.5 h-1.5 bg-green-400 rounded-full animate-ping opacity-40 delay-1000"></div>
          </div>
        </div>
      )}

      {/* Animated Chat Bar */}
      {isOpen && (
        <div 
          className={cn("fixed z-50 animate-slide-in-from-left", className)}
          style={{
            left: `${position.x}px`,
            top: `${position.y - 200}px`
          }}
        >
          <Card className="w-80 shadow-2xl border border-emerald-500/20 bg-gradient-to-br from-slate-900/95 via-emerald-950/30 to-slate-800/95 backdrop-blur-xl animate-glow">
            <CardHeader className="pb-3 border-b border-slate-700/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-gradient-to-r from-emerald-500/20 to-green-500/20 animate-pulse">
                    <div className="relative">
                      <Brain className="h-4 w-4 text-emerald-400 animate-bounce" />
                      <Sparkles className="absolute -top-1 -right-1 h-2 w-2 text-emerald-300 animate-pulse" />
                    </div>
                  </div>
                  <CardTitle className="text-sm font-semibold text-white animate-fade-in">
                    FlowLink AI Assistant
                  </CardTitle>
                  <Badge variant="secondary" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/20 animate-pulse">
                    <Zap className="h-3 w-3 mr-1 animate-pulse" />
                    AI
                  </Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsOpen(false)}
                  className="h-6 w-6 p-0 hover:bg-red-500/10 hover:scale-110 transition-all duration-200"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>

            <CardContent className="flex flex-col p-0 max-h-96">
              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 max-h-64">
                {messages.map((message, index) => (
                  <div
                    key={message.id}
                    className={cn(
                      "flex gap-3 animate-in slide-in-from-bottom duration-300",
                      message.role === 'user' ? 'justify-end' : 'justify-start'
                    )}
                    style={{ animationDelay: `${index * 100}ms` }}
                  >
                    {message.role === 'assistant' && (
                      <div className="p-1.5 rounded-lg bg-gradient-to-r from-emerald-500/20 to-green-500/20 flex-shrink-0 animate-pulse">
                        <div className="relative">
                          <Brain className="h-3 w-3 text-emerald-400" />
                          <Sparkles className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 text-emerald-300 animate-pulse" />
                        </div>
                      </div>
                    )}
                    
                    <div
                      className={cn(
                        "max-w-[80%] rounded-lg px-3 py-2 text-sm transition-all duration-300 hover:scale-105",
                        message.role === 'user'
                          ? "bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-lg"
                          : "bg-slate-800/50 text-slate-200 border border-slate-700/50 hover:border-emerald-500/30"
                      )}
                    >
                      <div className="whitespace-pre-wrap">{message.content}</div>
                      <div className={cn(
                        "text-xs mt-1 opacity-60",
                        message.role === 'user' ? "text-emerald-100" : "text-slate-400"
                      )}>
                        {formatTime(message.timestamp)}
                      </div>
                    </div>

                    {message.role === 'user' && (
                      <div className="p-1.5 rounded-lg bg-gradient-to-r from-emerald-500/20 to-purple-500/20 flex-shrink-0 animate-pulse">
                        <User className="h-3 w-3 text-emerald-400" />
                      </div>
                    )}
                  </div>
                ))}
                
                {isLoading && (
                  <div className="flex gap-3 justify-start animate-in slide-in-from-bottom duration-300">
                    <div className="p-1.5 rounded-lg bg-gradient-to-r from-emerald-500/20 to-green-500/20 flex-shrink-0 animate-pulse">
                      <div className="relative">
                        <Brain className="h-3 w-3 text-emerald-400" />
                        <Sparkles className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 text-emerald-300 animate-pulse" />
                      </div>
                    </div>
                    <div className="bg-slate-800/50 text-slate-200 border border-slate-700/50 rounded-lg px-3 py-2 text-sm animate-pulse">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>AI is thinking...</span>
                      </div>
                    </div>
                  </div>
                )}
                
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="p-4 border-t border-slate-700/50 animate-in slide-in-from-bottom duration-500">
                <div className="flex gap-2">
                  <Input
                    ref={inputRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Ask me anything about FlowLink..."
                    disabled={isLoading}
                    className="flex-1 bg-slate-800/50 border-slate-700/50 text-slate-200 placeholder:text-slate-400 focus:border-emerald-500/50 transition-all duration-300 focus:scale-105"
                  />
                  <Button
                    onClick={handleSendMessage}
                    disabled={!inputValue.trim() || isLoading}
                    size="sm"
                    className="bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 transition-all duration-300 hover:scale-110 disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Welcome Popup */}
      {showWelcomePopup && (
        <div 
          className="fixed z-50 animate-bounce-in cursor-pointer"
          style={{
            left: `${position.x + 80}px`,
            top: `${position.y - 50}px`
          }}
          onClick={() => setShowWelcomePopup(false)}
        >
          <div className="bg-gradient-to-r from-emerald-500 to-green-600 text-white px-4 py-3 rounded-lg shadow-lg border border-emerald-400/30 max-w-xs hover:shadow-xl transition-all duration-300">
            <div className="flex items-center gap-2 mb-2">
              <div className="relative">
                <Brain className="h-4 w-4 animate-pulse" />
                <Sparkles className="absolute -top-1 -right-1 h-2 w-2 text-emerald-200 animate-bounce" />
              </div>
              <span className="font-semibold text-sm">Hi! I'm your AI Assistant</span>
            </div>
            <p className="text-xs text-emerald-100">
              I can help you with FlowLink features, crypto payments, and compliance questions. Ask me anything!
            </p>
            {/* Arrow pointing to chat */}
            <div className="absolute -left-2 top-1/2 transform -translate-y-1/2">
              <div className="w-0 h-0 border-t-4 border-b-4 border-r-4 border-transparent border-r-emerald-500"></div>
            </div>
            {/* Close button */}
            <button 
              className="absolute -top-1 -right-1 w-5 h-5 bg-white/20 rounded-full flex items-center justify-center hover:bg-white/30 transition-colors duration-200"
              onClick={(e) => {
                e.stopPropagation()
                setShowWelcomePopup(false)
              }}
            >
              <X className="h-3 w-3 text-white" />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
