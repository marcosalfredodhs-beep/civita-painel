# Painel Civita Auxílio (TV)

Painel público para a TV do time comercial da Civita Auxílio, com dados ao vivo do CRM Vertto, gamificação (roleta de prêmios, pódio de comissão) e comemorações a cada conquista.

- **Produção:** https://dash.atticus.ag (também https://civita-painel.vercel.app)
- **Teste dos efeitos:** https://dash.atticus.ag/?teste=1 (toque na tela uma vez para liberar o som)

## Como funciona

```
Navegador / TV  ──(a cada 5 min)──▶  Edge Function civita-dashboard  ──(read only)──▶  Postgres do Vertto
 web/index.html                       supabase/functions/civita-dashboard                (Supabase SalesEnablement)
                                       + Meta Ads API (frequência, opcional)
```

- `web/` — página estática (HTML/CSS/JS puro, sem build), hospedada na Vercel.
- `supabase/functions/civita-dashboard/` — Edge Function que roda uma única consulta somente leitura (`query.sql.ts`) e devolve o JSON das telas. Cache de 60 s; exige a chave pública (anon) do projeto.
- `supabase/migrations/20261118_roleta.sql` — tabelas e função da roleta (referência; já aplicado em produção).

## Telas

1. **Marketing** — leads e CPL, MQL e custo por MQL, conversão, frequência/CTR; tabela por criativo (2 contas Meta somadas) ordenada por pastas vendidas.
2. **Vendas** — SQL, documentos coletados, em produção, pastas produzidas e vendidas; tabela por vendedor.
3. **Pódio & Roleta** — pódio por comissão da semana, roleta (Bruno aponta o prêmio, cabeça do Atos no centro), últimos prêmios e progresso para o próximo giro.

As telas alternam a cada 30 s. Parâmetros: `?rotacao=60` (segundos por tela), `?atualiza=120` (segundos entre buscas), `?teste=1`.

## Definições (semana = segunda a domingo, horário de SP)

| Métrica | Regra |
|---|---|
| MQL (marketing) | regra v2 do formulário (carteira assinada + sequela permanente causada pelo acidente que dificulta o trabalho); forms antigos: tem laudo |
| SQL | entrou na etapa "Coleta documentação" |
| Documento coletado | 1º arquivo de cada um dos 8 grupos da pasta (`pasta_doc_leituras`) |
| Pasta finalizada | os 8 grupos coletados |
| Pasta produzida | entrou em "Ofertada ao escritório" |
| Pasta vendida | `pedido_itens.pago_em` |
| Comissão gerada | R$ 80 por pasta vendida na semana |
| Comissão paga | `comissao_pasta_titulos.pago_em` |

## Roleta

- A cada 3 pastas vendidas do vendedor na semana nasce 1 giro (`roleta_giros`), com o prêmio sorteado **no banco** pela função `roleta_sincronizar()` (pg_cron, a cada minuto).
- Prêmios em `roleta_premios_catalogo`: `peso` = chance relativa; `pastas_minimas` = só libera a partir de X pastas na semana (Day off: 15 pastas, peso 7 = 30% menos chance).
- Contam só pastas pagas depois de `roleta_config.inicio_em`.
- Quando sai um giro, o painel mostra contagem de 10 s com foto e nome do vendedor e gira.
- O botão **GIRAR A ROLETA** é só teste: não grava nada e nunca cai no Day off.

## Alertas

Cada evento novo das últimas 48 h vira aviso com foto da pessoa, som, confete e chuva de cabecinhas do Atos: documento coletado, 1º documento da pasta, lead qualificado, entrada na coleta, pasta finalizada, pasta ofertada, pasta vendida, comissão gerada e comissão paga.

## Deploy

A página publica sozinha: a Vercel (projeto `civita-painel`) está ligada a este repositório e cada push na branch `main` vai ao ar em dash.atticus.ag em cerca de 1 minuto (Root Directory = `web`). Outras branches geram um link de prévia.

A Edge Function é publicada no projeto Supabase `thqrvqqdowfiunffhclj` com o nome `civita-dashboard` (`index.ts` + `query.sql.ts`).
Para a frequência da Meta, cadastrar o secret `META_TOKEN` nas Edge Functions do projeto.

## Pendências

- Critérios de MQL de marketing do PDF (hoje usa a regra v2).
- Metas semanais (a Civita não tem metas cadastradas no CRM).
- Lista real de prêmios da roleta (o catálogo tem 8 de exemplo).
- Secret `META_TOKEN` para a frequência.
- A função `avatar-upload-temp` (usada uma vez para subir fotos do time) está desativada e pode ser apagada no painel do Supabase.
