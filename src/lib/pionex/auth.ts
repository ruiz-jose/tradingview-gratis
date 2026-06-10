// Uso exclusivo server-side (API routes de Next.js).
// Nunca importar desde componentes cliente.

const PIONEX_BASE = "https://api.pionex.com";

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Ejecuta una llamada autenticada a la API de Pionex.
 *
 * Firma: METHOD + path + "?" + sorted_query_with_timestamp [+ body]
 * Referencia: https://pionex-doc.gitbook.io/apidocs/restful/general/authentication
 */
export async function pionexFetch(
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, string | number> = {},
  body?: object,
): Promise<Response> {
  const apiKey    = process.env.PIONEX_API_KEY;
  const apiSecret = process.env.PIONEX_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error("PIONEX_API_KEY y PIONEX_API_SECRET deben estar definidas en .env");
  }

  const timestamp = Date.now(); // milisegundos
  const allParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) allParams[k] = String(v);
  allParams.timestamp = String(timestamp);

  // Ordenar parámetros alphabéticamente por clave (requisito Pionex)
  const sortedQuery = Object.keys(allParams)
    .sort()
    .map((k) => `${k}=${allParams[k]}`)
    .join("&");

  // String a firmar: {METHOD}{path}?{sortedQuery}[{body}]
  const bodyStr = body ? JSON.stringify(body) : "";
  const toSign  = `${method}${path}?${sortedQuery}${bodyStr}`;

  const signature = await hmacSha256Hex(apiSecret, toSign);
  const url       = `${PIONEX_BASE}${path}?${sortedQuery}`;

  return fetch(url, {
    method,
    headers: {
      "PIONEX-KEY":       apiKey,
      "PIONEX-SIGNATURE": signature,
      ...(bodyStr ? { "Content-Type": "application/json" } : {}),
    },
    ...(bodyStr ? { body: bodyStr } : {}),
    cache: "no-store",
  });
}
