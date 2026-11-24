#!/usr/bin/env python3
"""Gera os áudios "Pasta concluída por <nome>" do painel, com a voz pt-BR-AntonioNeural (edge-tts, grátis).

Uso (precisa do edge-tts: pip install edge-tts):
    python3 scripts/gerar_vozes.py scripts/vozes_pessoas.json web/vozes

vozes_pessoas.json é uma lista de {"uid": "<user_id do CRM>", "nome": "<nome falado>"}.
Uma pessoa com mais de um cadastro aparece uma vez por user_id, com o mesmo nome: o áudio é gerado
uma vez só e os dois user_id apontam para ele em web/vozes/index.json.
Rodar de novo só gera os áudios que ainda não existem.
"""
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

VOZ = "pt-BR-AntonioNeural"
VELOCIDADE = "+8%"


def slug(nome: str) -> str:
    s = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def main(lista: str, destino: str) -> None:
    pessoas = json.loads(Path(lista).read_text(encoding="utf-8"))
    pasta = Path(destino)
    pasta.mkdir(parents=True, exist_ok=True)
    indice_path = pasta / "index.json"
    indice = json.loads(indice_path.read_text(encoding="utf-8")) if indice_path.exists() else {}
    for p in pessoas:
        arquivo = slug(p["nome"]) + ".mp3"
        if not (pasta / arquivo).exists():
            subprocess.run(
                ["edge-tts", "--voice", VOZ, f"--rate={VELOCIDADE}",
                 "--text", f"Pasta concluída por {p['nome']}!", "--write-media", str(pasta / arquivo)],
                check=True,
            )
            print("gerado:", arquivo)
        indice[p["uid"]] = arquivo
    indice_path.write_text(json.dumps(indice, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(len(indice), "user_id no índice")


if __name__ == "__main__":
    main(*sys.argv[1:3])
