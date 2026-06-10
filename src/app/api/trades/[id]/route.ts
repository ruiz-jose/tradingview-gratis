import { NextRequest, NextResponse } from "next/server";
import { closeTrade } from "@/lib/trade-logger";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { closePrice, closeReason } = await req.json() as {
    closePrice: number;
    closeReason: "TP1" | "TP2" | "SL" | "manual";
  };

  if (!closePrice || !closeReason) {
    return NextResponse.json({ error: "Campos requeridos: closePrice, closeReason" }, { status: 400 });
  }

  const trade = closeTrade(id, closePrice, closeReason);
  if (!trade) return NextResponse.json({ error: "Trade no encontrado" }, { status: 404 });

  return NextResponse.json(trade);
}
