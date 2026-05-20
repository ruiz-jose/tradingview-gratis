import { NextRequest, NextResponse } from "next/server";

const TELEGRAM_API = "https://api.telegram.org";

export async function POST(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return NextResponse.json(
      { error: "Telegram no configurado. Define TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID en .env.local" },
      { status: 500 }
    );
  }

  const body = await req.json();
  const { message } = body as { message?: string };

  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "Campo 'message' requerido" }, { status: 400 });
  }

  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: `Telegram API error: ${err}` }, { status: res.status });
  }

  return NextResponse.json({ ok: true });
}
