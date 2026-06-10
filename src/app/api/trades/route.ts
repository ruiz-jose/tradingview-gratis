import { NextRequest, NextResponse } from "next/server";
import { getAllTrades, logTrade, type NewTradeInput } from "@/lib/trade-logger";

export async function GET() {
  return NextResponse.json(getAllTrades());
}

export async function POST(req: NextRequest) {
  const body = await req.json() as NewTradeInput;

  if (!body.symbol || !body.direction || !body.entryPrice || !body.stopLoss || !body.tp1 || !body.tp2) {
    return NextResponse.json({ error: "Campos requeridos: symbol, direction, entryPrice, stopLoss, tp1, tp2" }, { status: 400 });
  }

  const trade = logTrade(body);
  return NextResponse.json(trade, { status: 201 });
}
