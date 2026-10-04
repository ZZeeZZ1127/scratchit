import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SYSTEM_PROMPT =
  "You are a warm, encouraging writer. Given a photo and its color palette, write ONE short, original, positive, inspirational sentence (12 words or fewer) that matches the mood and subject of the image. Do not quote famous authors, do not include an attribution, and keep the tone uplifting.";

const FALLBACKS = [
  "Every picture tells a story.",
  "Small moments make the biggest memories.",
  "Let the little things spark joy.",
  "Hold close the light hidden in ordinary moments.",
  "Today’s quiet details can become tomorrow’s brightest memories.",
  "Beauty grows wherever attention and gratitude meet.",
  "Carry this moment forward with courage and wonder.",
  "Joy often begins in the places we pause to notice.",
  "The simplest scenes can hold the deepest meaning.",
  "Let this memory remind you how far you have come.",
  "There is always more light waiting to be noticed.",
  "Keep making room for moments that feel alive."
];

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 8;
const MAX_BODY_BYTES = 800_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

function fallback() {
  return FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];
}

function clientId(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function rateLimited(id: string) {
  const now = Date.now();
  const current = buckets.get(id);
  if (!current || current.resetAt <= now) {
    buckets.set(id, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > MAX_REQUESTS;
}

function cleanQuote(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .replace(/^```(?:json)?|```$/gi, "")
    .replace(/^\s*(?:quote\s*:\s*)?/i, "")
    .replace(/^["“]|["”]$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function extractJsonQuote(text: string) {
  try {
    const parsed = JSON.parse(text);
    return cleanQuote(parsed.quote);
  } catch {
    return cleanQuote(text);
  }
}

async function askOpenAI(thumbnail: string, palette: string[]) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return "";

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.8,
      max_tokens: 60,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Palette: ${palette.join(", ")}. Return only JSON shaped exactly as {"quote":"your sentence"}.`
            },
            {
              type: "image_url",
              image_url: { url: thumbnail, detail: "low" }
            }
          ]
        }
      ]
    }),
    signal: AbortSignal.timeout(20_000)
  });

  if (!response.ok) return "";
  const data = await response.json();
  return extractJsonQuote(data?.choices?.[0]?.message?.content || "");
}

async function askAnthropic(thumbnail: string, palette: string[]) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return "";

  const match = thumbnail.match(/^data:(image\/jpeg);base64,(.+)$/);
  if (!match) return "";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
      max_tokens: 60,
      temperature: 0.8,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: match[1],
                data: match[2]
              }
            },
            {
              type: "text",
              text: `Palette: ${palette.join(", ")}. Return only the sentence.`
            }
          ]
        }
      ]
    }),
    signal: AbortSignal.timeout(20_000)
  });

  if (!response.ok) return "";
  const data = await response.json();
  const text = data?.content?.find((item: { type?: string }) => item.type === "text")?.text;
  return extractJsonQuote(text || "");
}

export async function POST(request: NextRequest) {
  if (rateLimited(clientId(request))) {
    return NextResponse.json({ quote: fallback(), fallback: true });
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ quote: fallback(), fallback: true });
  }

  try {
    const body = await request.json();
    const thumbnail = typeof body?.thumbnail === "string" ? body.thumbnail : "";
    const palette = Array.isArray(body?.palette)
      ? body.palette.filter((color: unknown) => typeof color === "string").slice(0, 6)
      : [];

    if (
      thumbnail.length > 700_000 ||
      !/^data:image\/jpeg;base64,[a-zA-Z0-9+/=]+$/.test(thumbnail) ||
      palette.length < 1 ||
      palette.some((color: string) => !/^#[0-9a-f]{6}$/i.test(color))
    ) {
      return NextResponse.json({ quote: fallback(), fallback: true });
    }

    const provider = (process.env.LLM_PROVIDER || "openai").toLowerCase();
    const generated =
      provider === "anthropic"
        ? await askAnthropic(thumbnail, palette)
        : await askOpenAI(thumbnail, palette);

    return NextResponse.json({
      quote: generated || fallback(),
      fallback: !generated
    });
  } catch {
    return NextResponse.json({ quote: fallback(), fallback: true });
  }
}
