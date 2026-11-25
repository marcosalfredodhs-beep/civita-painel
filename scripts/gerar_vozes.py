#!/usr/bin/env python3
"""Gera os áudios do painel com a voz pt-BR-AntonioNeural (edge-tts, grátis):
"Pasta concluída por <nome>!" em web/vozes/, "<nome> vai girar a roleta!" em web/vozes/roleta/ (mesmo nome de arquivo)
e "<nome> ganhou <prêmio>!" em web/vozes/premio/<pessoa>/<prêmio>.mp3, um por prêmio de scripts/vozes_premios.json
(a lista de prêmios ativos da roleta_premios_catalogo; atualizar quando o catálogo mudar).

Uso (precisa do edge-tts: pip install edge-tts):
    python3 scripts/gerar_vozes.py scripts/vozes_pessoas.json web/vozes

vozes_pessoas.json é uma lista de {"uid": "<user_id do CRM>", "nome": "<nome falado>"}.
Uma pessoa com mais de um cadastro aparece uma vez por user_id, com o mesmo nome: o áudio é gerado
uma vez só e os dois user_id apontam para ele em web/vozes/index.json.
Rodar de novo só gera os áudios que ainda não existem.
"""
import json
import re
from concurrent.futures import ThreadPoolExecutor
import subprocess
import sys
import unicodedata
from pathlib import Path

VOZ = "pt-BR-AntonioNeural"
VELOCIDADE = "+8%"


def slug(nome: str) -> str:
    s = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


FRASES = {"": "Pasta concluída por {nome}!", "roleta": "{nome} vai girar a roleta!"}


def gerar(arquivo: Path, texto: str) -> None:
    if arquivo.exists():
        return
    arquivo.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["edge-tts", "--voice", VOZ, f"--rate={VELOCIDADE}", "--text", texto, "--write-media", str(arquivo)], check=True)
    print("gerado:", arquivo)


def premio_falado(nome: str) -> str:
    m = re.match(r"R\$\s*([\d.]+)", nome)
    return f"{m.group(1)} reais" if m else "um " + nome.lower()


def main(lista: str, destino: str, premios: str = "scripts/vozes_premios.json") -> None:
    pessoas = json.loads(Path(lista).read_text(encoding="utf-8"))
    pasta = Path(destino)
    pasta.mkdir(parents=True, exist_ok=True)
    indice_path = pasta / "index.json"
    indice = json.loads(indice_path.read_text(encoding="utf-8")) if indice_path.exists() else {}
    lista_premios = json.loads(Path(premios).read_text(encoding="utf-8")) if Path(premios).exists() else []
    tarefas = []
    for p in pessoas:
        arquivo = slug(p["nome"]) + ".mp3"
        for sub, frase in FRASES.items():
            tarefas.append((pasta / sub / arquivo, frase.format(nome=p["nome"])))
        for pr in lista_premios:
            tarefas.append((pasta / "premio" / slug(p["nome"]) / (slug(pr) + ".mp3"), f"{p['nome']} ganhou {premio_falado(pr)}!"))
        indice[p["uid"]] = arquivo
    with ThreadPoolExecutor(6) as ex:
        list(ex.map(lambda t: gerar(*t), dict(tarefas).items()))
    indice_path.write_text(json.dumps(indice, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(len(indice), "user_id no índice")


if __name__ == "__main__":
    main(*sys.argv[1:4])
