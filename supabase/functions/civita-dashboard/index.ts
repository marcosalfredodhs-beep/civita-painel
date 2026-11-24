// Edge Function pública e somente leitura do dashboard da Civita Auxílio.
// GET -> JSON com marketing, funil, vendedores, roleta e alertas da semana atual.
// Banco: transação READ ONLY via SUPABASE_DB_URL. Meta: alcance/frequência via META_TOKEN (secret opcional).
import postgres from "npm:postgres@3.4.5";
import { QUERY } from "./query.sql.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2, idle_timeout: 20 });
const META_TOKEN = Deno.env.get("META_TOKEN") ?? "";
const META_ACCOUNTS = ["act_1125448719975468", "act_1394629119102550"];
const DB_TTL = 60_000; // no máximo 1 consulta ao banco por minuto, independente de quantas telas abertas
const META_TTL = 5 * 60_000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

let dbCache: { at: number; data: unknown } | null = null;
let metaCache: { at: number; key: string; data: unknown } | null = null;

async function loadDb() {
  if (dbCache && Date.now() - dbCache.at < DB_TTL) return dbCache.data;
  const rows = await sql.begin("read only", (tx) => tx.unsafe(QUERY));
  dbCache = { at: Date.now(), data: rows[0].data };
  return dbCache.data;
}

async function loadMeta(since: string) {
  if (!META_TOKEN) return { ok: false, motivo: "sem_token" };
  const until = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const key = since + until;
  if (metaCache && metaCache.key === key && Date.now() - metaCache.at < META_TTL) return metaCache.data;
  let reach = 0, imp = 0, clk = 0, spend = 0;
  const contas: unknown[] = [];
  for (const acc of META_ACCOUNTS) {
    const u = new URL(`https://graph.facebook.com/v21.0/${acc}/insights`);
    u.searchParams.set("fields", "reach,frequency,impressions,clicks,spend");
    u.searchParams.set("time_range", JSON.stringify({ since, until }));
    u.searchParams.set("access_token", META_TOKEN);
    const r = await fetch(u);
    const j = await r.json();
    if (!r.ok) return { ok: false, motivo: j?.error?.message ?? `http_${r.status}` };
    const d = j.data?.[0] ?? {};
    reach += +d.reach || 0; imp += +d.impressions || 0; clk += +d.clicks || 0; spend += +d.spend || 0;
    contas.push({ conta: acc, reach: +d.reach || 0, frequency: +d.frequency || 0 });
  }
  const data = { ok: true, reach, imp, clk, spend, frequency: reach ? imp / reach : 0, contas, at: new Date().toISOString() };
  metaCache = { at: Date.now(), key, data };
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const data = (await loadDb()) as { semana_ini: string };
    let meta: unknown;
    try { meta = await loadMeta(data.semana_ini); } catch (e) { meta = { ok: false, motivo: String(e) }; }
    return new Response(JSON.stringify({ ...data, meta }), {
      headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ erro: "falha_ao_consultar" }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
