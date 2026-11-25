#!/usr/bin/env python3
"""Servidor local do painel para conferir mudanças antes de publicar.

Serve a pasta web/ e troca a chamada da Edge Function por /dados, que roda a consulta
de supabase/functions/civita-dashboard/query.sql.ts DESTE checkout direto no banco
(API de gestão do Supabase, com o login do Supabase CLI). Assim a página local já mostra
o que a função vai devolver depois do deploy. O bloco "meta" (alcance do Meta) vem da
função publicada, porque o token do Meta só existe lá.

Uso (na raiz do repositório):
    python3 scripts/servidor_local.py            # http://127.0.0.1:8080
    python3 scripts/servidor_local.py 8090       # outra porta

Precisa do login do Supabase CLI (~/.supabase/access-token) ou da variável SUPABASE_ACCESS_TOKEN.
"""
import json
import os
import re
import sys
import time
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
WEB = RAIZ / "web"
CONSULTA = RAIZ / "supabase/functions/civita-dashboard/query.sql.ts"
PROJETO = "thqrvqqdowfiunffhclj"
FUNCAO = f"https://{PROJETO}.supabase.co/functions/v1/civita-dashboard"
UA = "civita-painel-local"
_cache = {"em": 0.0, "dados": None}


def token() -> str:
    t = os.environ.get("SUPABASE_ACCESS_TOKEN")
    if t:
        return t.strip()
    return (Path.home() / ".supabase/access-token").read_text().strip()


def chave_publica() -> str:
    m = re.search(r'KEY:\s*"([^"]+)"', (WEB / "index.html").read_text(encoding="utf-8"))
    return m.group(1) if m else ""


def consulta_local() -> dict:
    texto = CONSULTA.read_text(encoding="utf-8")
    sql = texto[texto.index("`") + 1 : texto.rindex("`")]
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJETO}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json", "User-Agent": UA},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)[0]["data"]


def meta_publicada() -> dict:
    k = chave_publica()
    req = urllib.request.Request(FUNCAO, headers={"Authorization": "Bearer " + k, "apikey": k, "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r).get("meta") or {"ok": False, "motivo": "sem_meta"}
    except Exception as e:  # a página aceita meta indisponível
        return {"ok": False, "motivo": str(e)}


def dados() -> bytes:
    if _cache["dados"] is None or time.time() - _cache["em"] > 60:
        d = consulta_local()
        d["meta"] = meta_publicada()
        _cache.update(em=time.time(), dados=json.dumps(d).encode())
    return _cache["dados"]


class Painel(SimpleHTTPRequestHandler):
    def _enviar(self, corpo: bytes, tipo: str, so_cabecalho=False):
        self.send_response(200)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if not so_cabecalho:
            self.wfile.write(corpo)

    def _rota(self, so_cabecalho=False):
        caminho = self.path.split("?")[0]
        if caminho == "/dados":
            try:
                self._enviar(dados(), "application/json", so_cabecalho)
            except Exception as e:
                self.send_error(500, str(e))
            return True
        if caminho in ("/", "/index.html"):
            html = (WEB / "index.html").read_text(encoding="utf-8").replace(FUNCAO, "/dados")
            self._enviar(html.encode(), "text/html; charset=utf-8", so_cabecalho)
            return True
        return False

    def do_GET(self):
        if not self._rota():
            super().do_GET()

    def do_HEAD(self):
        if not self._rota(so_cabecalho=True):
            super().do_HEAD()


if __name__ == "__main__":
    porta = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print(f"Painel local em http://127.0.0.1:{porta} (dados da consulta deste checkout)")
    ThreadingHTTPServer(("127.0.0.1", porta), partial(Painel, directory=str(WEB))).serve_forever()
