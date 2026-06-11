import { NextResponse } from "next/server";
import { pionexFetch } from "@/lib/pionex/auth";
import type { PionexBalanceResponse, PionexApiError } from "@/lib/pionex/types";

export async function GET() {
  try {
    const res  = await pionexFetch("GET", "/api/v1/account/balances");
    const data = (await res.json()) as PionexBalanceResponse | PionexApiError;

    if (!res.ok || !data.result) {
      const msg = (data as PionexApiError).message ?? `HTTP ${res.status}`;
      return NextResponse.json({ ok: false, error: msg }, { status: 502 });
    }

    const balances = (data as PionexBalanceResponse).data.balances;

    // Solo devolver monedas con saldo > 0
    const nonEmpty = balances.filter(
      (b) => parseFloat(b.free) > 0 || parseFloat(b.frozen) > 0,
    );

    const btc  = balances.find((b) => b.coin === "BTC");
    const usdt = balances.find((b) => b.coin === "USDT");

    return NextResponse.json({
      ok: true,
      message: "Conexión con Pionex exitosa ✓",
      btc:  btc  ? { free: btc.free,   frozen: btc.frozen  } : { free: "0", frozen: "0" },
      usdt: usdt ? { free: usdt.free,  frozen: usdt.frozen } : { free: "0", frozen: "0" },
      allBalances: nonEmpty,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
