#!/usr/bin/env python3
"""Acha vendedores e prêmios da roleta que ainda não têm áudio e gera as vozes deles.

Lê a função publicada (civita-dashboard, com a chave pública que já está em web/index.html):
- "pessoas" (user_id -> nome): quem ainda não está em web/vozes/index.json entra em scripts/vozes_pessoas.json
  com o nome falado = primeiro + último nome do cadastro;
- "premios": a lista de prêmios ativos vira scripts/vozes_premios.json.
Depois roda gerar_vozes.py, que só cria os áudios que faltam. Usado pelo GitHub Actions (.github/workflows/vozes.yml)
e também dá para rodar à mão:  python3 scripts/vozes_novos.py
"""
import json
import re
import urllib.request
from pathlib import Path

import gerar_vozes

RAIZ = Path(__file__).resolve().parent.parent
HTML = (RAIZ / "web/index.html").read_text(encoding="utf-8")
API = re.search(r'API:\s*"([^"]+)"', HTML).group(1)
KEY = re.search(r'KEY:\s*"([^"]+)"', HTML).group(1)
PESSOAS = RAIZ / "scripts/vozes_pessoas.json"
PREMIOS = RAIZ / "scripts/vozes_premios.json"
INDICE = RAIZ / "web/vozes/index.json"


def nome_falado(nome: str) -> str:
    partes = nome.split()
    return partes[0] if len(partes) == 1 else f"{partes[0]} {partes[-1]}"


def main() -> None:
    req = urllib.request.Request(API, headers={"Authorization": "Bearer " + KEY, "apikey": KEY, "User-Agent": "civita-painel-vozes"})
    with urllib.request.urlopen(req, timeout=90) as r:
        dados = json.load(r)
    lista = json.loads(PESSOAS.read_text(encoding="utf-8"))
    conhecidos = {p["uid"] for p in lista} | set(json.loads(INDICE.read_text(encoding="utf-8")))
    novos = [{"uid": uid, "nome": nome_falado(p["nome"])} for uid, p in (dados.get("pessoas") or {}).items()
             if uid not in conhecidos and (p.get("nome") or "").strip()]
    if novos:
        lista += novos
        PESSOAS.write_text("[\n" + ",\n".join(" " + json.dumps(p, ensure_ascii=False) for p in lista) + "\n]\n", encoding="utf-8")
        print("novos vendedores:", ", ".join(p["nome"] for p in novos))
    premios = sorted({p["nome"] for p in dados.get("premios") or [] if p.get("nome")})
    if premios and premios != sorted(json.loads(PREMIOS.read_text(encoding="utf-8"))):
        PREMIOS.write_text(json.dumps(premios, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print("prêmios atualizados:", ", ".join(premios))
    gerar_vozes.main(str(PESSOAS), str(RAIZ / "web/vozes"), str(PREMIOS))


if __name__ == "__main__":
    main()
