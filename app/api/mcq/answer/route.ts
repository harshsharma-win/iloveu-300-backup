import { NextResponse } from 'next/server'
import { isRelaySessionValid } from '@/lib/relay-session'

type McqOption = { letter: string; text: string }

export async function POST(request: Request) {
  if (!isRelaySessionValid(request)) {
    return NextResponse.json({ ok: false, error: 'Dashboard session required.' }, { status: 401 })
  }

  let body: { question?: string; options?: McqOption[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 })
  }

  const question = body.question?.trim() ?? ''
  const options = Array.isArray(body.options) ? body.options : []
  if (!question || !options.length) {
    return NextResponse.json({ ok: false, error: 'Question and options are required.' }, { status: 400 })
  }

  const apiKey = process.env.AI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'AI answer provider is not configured.' }, { status: 503 })
  }

  const promptOptions = options
    .filter((option) => /^[ABCD]$/i.test(option.letter))
    .map((option) => `${option.letter.toUpperCase()}. ${option.text.trim()}`)
    .join('\n')

  try {
    const response = await fetch(process.env.AI_PROVIDER_URL ?? 'https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL ?? 'llama-3.3-70b-versatile',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Choose exactly one multiple-choice option. Return JSON only: {"answer":"A|B|C|D","confidence":0-100,"reason":"short reason"}.',
          },
          { role: 'user', content: `Question: ${question}\nOptions:\n${promptOptions}` },
        ],
      }),
    })

    if (!response.ok) {
      const detail = await response.text()
      return NextResponse.json({ ok: false, error: `AI provider failed (${response.status})`, detail }, { status: 502 })
    }

    const result = await response.json()
    const content = result.choices?.[0]?.message?.content ?? '{}'
    const parsed = JSON.parse(content)
    const answer = String(parsed.answer ?? '').trim().toUpperCase()
    if (!['A', 'B', 'C', 'D'].includes(answer)) {
      return NextResponse.json({ ok: false, error: 'AI provider returned an invalid answer.' }, { status: 502 })
    }

    const confidence = Math.max(0, Math.min(100, Number(parsed.confidence) || 0))
    return NextResponse.json({ ok: true, answer, confidence, reason: String(parsed.reason ?? '') })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Unable to solve the question.' }, { status: 502 })
  }
}
