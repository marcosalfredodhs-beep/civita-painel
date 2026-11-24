// Consulta única, somente leitura, que monta todos os dados do dashboard da Civita Auxílio.
// Período: semana atual (segunda 00:00 até agora, horário de São Paulo).
// Regras (revisar quando chegarem as definições finais):
//   MQL marketing: regra v2 do formulário (carteira assinada + sequela permanente + causada pelo acidente + dificulta o trabalho);
//                  forms antigos sem essas perguntas: tem laudo. TROCAR pela regra do PDF quando chegar.
//   SQL (campo sql_vendas / funil.coleta): entrou na etapa "Coleta documentação".
//   Qualificação (funil.sql): entrou na etapa "Qualificação".
//   Roleta: roleta_pastas (1 linha por pasta paga) e roleta_giros (premiações), via roleta_sincronizar() no pg_cron.
//           Prêmio com pastas_minimas (ex.: Day off = 15) só sai a partir dessa qtd de pastas do vendedor na semana; peso = chance relativa.
//   Documento coletado: 1º arquivo de cada um dos 8 grupos da pasta (pasta_doc_leituras), sem Kit Contratos / Outros anexos.
//   Pasta finalizada: os 8 grupos coletados. Pasta produzida: entrou em "Ofertada ao escritório".
//   Pasta vendida/paga: pedido_itens com pago_em (origem_deal_id = negócio da Civita).
//   Comissão gerada: R$ 80 por pasta vendida na semana (pastas vendidas x 80); o alerta de comissão gerada sai junto com cada pasta paga;
//                    comissão paga = comissao_pasta_titulos.pago_em (título pago ao vendedor).
export const QUERY = /* sql */ `
with p as (
  select (date_trunc('week', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo' ini_ts,
         (date_trunc('week', now() at time zone 'America/Sao_Paulo'))::date ini,
         now() - interval '48 hours' alert_ts
), k as (
  select '1ae9d44a-5a9b-4c8b-b184-0f31e1ca3cfc'::uuid org,
         '7f4b74c8-7ed6-430b-86fd-08f34c55c057'::uuid coleta,
         '317b7841-c2ba-494b-b233-42b084e79a26'::uuid ofertada,
         'd10fcc62-53e5-4f05-873a-013f5a076ccd'::uuid qualif,
         array['3fc751c7-05f3-4c07-bbad-6ed585fc85aa','961c3e05-b496-4cbd-9812-6ea395cfb31c','42007ba7-2e85-48a8-84ad-6828fc34c272','d10fcc62-53e5-4f05-873a-013f5a076ccd']::uuid[] abertos
), cd as (
  select d.id, d.owner_id, d.stage_id, d.created_at, d.custom_data, d.lead_id
  from deals d, k
  where d.org_id = k.org and d.status is distinct from 'deleted' and d.merged_into_deal_id is null
), mq as (
  select cd.id, cd.owner_id, cd.created_at,
    case when cd.custom_data ? 'voce_ficou_com_alguma_sequela_ou_limitacao_permanente_mesmo_depois_de_terminar_a_recuperacao' then
      lower(btrim(rtrim(coalesce(cd.custom_data->>'na_epoca_do_acidente_ou_do_inicio_do_problema_qual_era_sua_situacao',''),'.'))) in ('empregado de empresa, com carteira assinada','empregado doméstico, com carteira assinada')
      and lower(btrim(rtrim(coalesce(cd.custom_data->>'voce_ficou_com_alguma_sequela_ou_limitacao_permanente_mesmo_depois_de_terminar_a_recuperacao',''),'.'))) = 'sim, já terminei a recuperação e continuo com a limitação'
      and lower(btrim(rtrim(coalesce(cd.custom_data->>'essa_sequela_foi_causada_pelo_acidente_que_voce_sofreu',''),'.'))) = 'sim'
      and lower(btrim(rtrim(coalesce(cd.custom_data->>'essa_sequela_dificulta_ou_exige_mais_esforco_para_realizar_o_trabalho_que_voce_fazia_na_epoca_do_acidente',''),'.'))) = 'sim'
    else lower(btrim(rtrim(coalesce(cd.custom_data->>'voce_ja_possui_laudo_medico_da_sequela',''),'.'))) = 'sim'
      or lower(btrim(rtrim(coalesce(cd.custom_data->>'lead_possui_exames',''),'.'))) = 'tenho' end mql
  from cd, p where cd.created_at >= least(p.ini_ts, p.alert_ts)
), ent as (
  select x.deal_id, x.stage_id, min(x.entered_at) em
  from deal_stage_log x, k
  where x.org_id = k.org and x.stage_id in (k.coleta, k.ofertada, k.qualif)
  group by 1, 2
), docs as (
  select l.deal_id, l.grupo, min(l.created_at) em
  from pasta_doc_leituras l, k
  where l.org_id = k.org and l.grupo is not null and l.grupo not in ('Kit Contratos','Outros anexos','Anexos avulsos')
  group by 1, 2
), docs1 as (
  select deal_id, min(em) primeiro from docs group by 1
), pf as (
  select deal_id, max(em) em from docs group by 1 having count(*) >= 8
), pag as (
  select pi.id, pi.origem_deal_id deal_id, pi.pago_em, pi.valor
  from pedido_itens pi join cd on cd.id = pi.origem_deal_id
  where pi.pago_em is not null
),
-- ===== Marketing (2 contas Meta da Civita, agrupado por criativo) =====
acc as (
  select id from org_ad_accounts
  where org_id = '08ae88ea-ca08-43fc-88f0-8c67b54783fd' and source = 'meta_ads'
    and ad_account_id in ('1125448719975468','1394629119102550')
), hist as (
  select x.* from marketing_ad_daily x
  where x.org_id = '08ae88ea-ca08-43fc-88f0-8c67b54783fd' and x.account_id in (select id from acc)
), adn as (
  select distinct on (ad_id) ad_id, btrim(ad_name) ad_name, lower(regexp_replace(btrim(ad_name), '\\s+', ' ', 'g')) n
  from hist order by ad_id, day desc
), meta_leads as (
  select cd.id, cd.created_at,
    coalesce((select a.n from adn a where a.ad_id = btrim(l.utm_content) limit 1),
             nullif(lower(regexp_replace(btrim(replace(coalesce(l.utm_content,''), '+', ' ')), '\\s+', ' ', 'g')), '')) n
  from cd join leads l on l.id = cd.lead_id
  where (lower(btrim(coalesce(l.utm_source,''))) ~ '^(fb|facebook|ig|instagram|meta|an|msg)([_.-].*)?$'
         and lower(btrim(coalesce(l.utm_medium,''))) not in ('social','bio','organic','organico','orgânico','link_in_bio')
         and lower(btrim(coalesce(l.utm_content,''))) <> 'link_in_bio')
     or coalesce(l.source,'') ilike '%lead form (meta)%'
), met as (
  select a.n, sum(h.spend) spend, sum(h.impressions) imp, sum(h.clicks) clk, sum(h.link_clicks) lclk
  from hist h join adn a on a.ad_id = h.ad_id, p where h.day >= p.ini group by 1
), crm as (
  select ml.n, count(*) leads, count(*) filter (where mq.mql) mql
  from meta_leads ml join mq on mq.id = ml.id, p where ml.created_at >= p.ini_ts group by 1
), vend as (
  select ml.n, count(*) vendidas from pag join meta_leads ml on ml.id = pag.deal_id, p where pag.pago_em >= p.ini_ts group by 1
), ads as (
  select coalesce(met.n, crm.n, vend.n) n, coalesce(met.spend,0) spend, coalesce(met.imp,0) imp, coalesce(met.clk,0) clk,
    coalesce(crm.leads,0) leads, coalesce(crm.mql,0) mql, coalesce(vend.vendidas,0) vendidas
  from met full join crm on crm.n = met.n full join vend on vend.n = coalesce(met.n, crm.n)
),
-- ===== Vendedores =====
sel as (
  select cd.owner_id uid,
    count(*) filter (where cd.created_at >= p.ini_ts) leads_rec,
    count(*) filter (where cd.stage_id = any(k.abertos)) abertos,
    count(*) filter (where cd.stage_id = k.coleta) em_producao
  from cd, p, k where cd.owner_id is not null group by 1
), sel_ev as (
  select c.owner_id uid,
    count(*) filter (where e.stage_id = k.coleta) sql_vendas,
    count(*) filter (where e.stage_id = k.ofertada) produzidas
  from ent e join cd c on c.id = e.deal_id, p, k where e.em >= p.ini_ts group by 1
), sel_docs as (
  select c.owner_id uid, count(*) docs from docs d join cd c on c.id = d.deal_id, p where d.em >= p.ini_ts group by 1
), sel_pag as (
  select c.owner_id uid, count(*) vendidas from pag join cd c on c.id = pag.deal_id, p where pag.pago_em >= p.ini_ts group by 1
), sellers as (
  select s.uid, pr.full_name nome, pr.avatar_url foto, s.leads_rec, s.abertos,
    coalesce(e.sql_vendas,0) sql_vendas, coalesce(dc.docs,0) docs, s.em_producao,
    coalesce(e.produzidas,0) produzidas, coalesce(pg.vendidas,0) vendidas, coalesce(pg.vendidas,0) * 80 comissao
  from sel s
  left join profiles pr on pr.user_id = s.uid
  left join sel_ev e on e.uid = s.uid left join sel_docs dc on dc.uid = s.uid
  left join sel_pag pg on pg.uid = s.uid
  where s.leads_rec > 0 or s.abertos > 0 or coalesce(pg.vendidas,0) > 0
),
-- ===== Roleta: tabelas roleta_pastas / roleta_giros (alimentadas por roleta_sincronizar via pg_cron) =====
giros as (
  select g.id, g.user_id uid, g.ultima_pasta_paga_em ts, g.premio_id, g.premio_nome, g.semana, g.numero, g.entregue
  from roleta_giros g, k where g.org_id = k.org
  order by g.ultima_pasta_paga_em desc nulls last limit 30
), rumo as (
  select rp.user_id uid, count(*) n
  from roleta_pastas rp, k, p
  where rp.org_id = k.org and rp.giro_id is null and rp.user_id is not null and rp.semana = p.ini
  group by 1
),
-- ===== Alertas (últimas 48h) =====
alertas as (
  select 'doc:'||d.deal_id||':'||d.grupo id, d.em ts, case when d.em = d1.primeiro then 'primeiro_doc' else 'doc' end tipo, c.owner_id uid, d.grupo detalhe, null::numeric valor
    from docs d join docs1 d1 on d1.deal_id = d.deal_id join cd c on c.id = d.deal_id, p where d.em >= p.alert_ts
  union all
  select 'mql:'||mq.id, mq.created_at, 'mql', mq.owner_id, null, null from mq, p where mq.mql and mq.created_at >= p.alert_ts
  union all
  select 'coleta:'||e.deal_id, e.em, 'coleta', c.owner_id, null, null from ent e join cd c on c.id = e.deal_id, p, k where e.stage_id = k.coleta and e.em >= p.alert_ts
  union all
  select 'finalizada:'||pf.deal_id, pf.em, 'finalizada', c.owner_id, null, null from pf join cd c on c.id = pf.deal_id, p where pf.em >= p.alert_ts
  union all
  select 'ofertada:'||e.deal_id, e.em, 'ofertada', c.owner_id, null, null from ent e join cd c on c.id = e.deal_id, p, k where e.stage_id = k.ofertada and e.em >= p.alert_ts
  union all
  select 'paga:'||pag.id, pag.pago_em, 'paga', c.owner_id, null, pag.valor from pag join cd c on c.id = pag.deal_id, p where pag.pago_em >= p.alert_ts
  union all
  select 'comissao:'||pag.id, pag.pago_em, 'comissao', c.owner_id, null, 80::numeric from pag join cd c on c.id = pag.deal_id, p where pag.pago_em >= p.alert_ts
  union all
  select 'comissao_paga:'||t.id, t.pago_em, 'comissao_paga', t.user_id, null, t.valor
    from comissao_pasta_titulos t, p
    where t.pago_em >= p.alert_ts and exists (select 1 from comissao_pasta_repasses r join cd on cd.id = r.deal_id where r.titulo_id = t.id)
)
select json_build_object(
  'gerado_em', now(),
  'semana_ini', (select ini from p),
  'mkt', json_build_object(
    'spend', (select coalesce(sum(spend),0) from ads),
    'imp', (select coalesce(sum(imp),0) from ads),
    'clk', (select coalesce(sum(clk),0) from ads),
    'leads', (select count(*) from meta_leads, p where meta_leads.created_at >= p.ini_ts),
    'mql', (select count(*) from meta_leads ml join mq on mq.id = ml.id, p where ml.created_at >= p.ini_ts and mq.mql),
    'synced_at', (select max(synced_at) from hist)
  ),
  'ads', (select coalesce(json_agg(json_build_object(
      'nome', coalesce((select a.ad_name from adn a where a.n = ads.n limit 1), ads.n, '(sem anúncio identificado)'),
      'spend', round(ads.spend, 2), 'imp', ads.imp, 'clk', ads.clk, 'leads', ads.leads, 'mql', ads.mql, 'vendidas', ads.vendidas)
      order by ads.vendidas desc, ads.mql desc, ads.spend desc), '[]') from ads where ads.spend > 0 or ads.leads > 0 or ads.vendidas > 0),
  'funil', json_build_object(
    'leads', (select count(*) from cd, p where cd.created_at >= p.ini_ts),
    'mql', (select count(*) from mq, p where mq.mql and mq.created_at >= p.ini_ts),
    'sql', (select count(*) from ent, p, k where ent.stage_id = k.qualif and ent.em >= p.ini_ts),
    'coleta', (select count(*) from ent, p, k where ent.stage_id = k.coleta and ent.em >= p.ini_ts),
    'docs', (select count(*) from docs, p where docs.em >= p.ini_ts),
    'pastas_com_doc', (select count(*) from docs1, p where docs1.primeiro >= p.ini_ts),
    'finalizadas', (select count(*) from pf, p where pf.em >= p.ini_ts),
    'produzidas', (select count(*) from ent, p, k where ent.stage_id = k.ofertada and ent.em >= p.ini_ts),
    'pagas', (select count(*) from pag, p where pag.pago_em >= p.ini_ts),
    'em_producao', (select count(*) from cd, k where cd.stage_id = k.coleta)
  ),
  'vendedores', (select coalesce(json_agg(row_to_json(s) order by s.vendidas desc, s.produzidas desc, s.comissao desc, s.sql_vendas desc, s.leads_rec desc), '[]') from sellers s),
  'giros', (select coalesce(json_agg(json_build_object('id', g.id, 'uid', g.uid, 'ts', g.ts, 'premio_id', g.premio_id, 'premio', g.premio_nome,
              'semana', g.semana, 'numero', g.numero, 'entregue', g.entregue) order by g.ts desc nulls last), '[]') from giros g),
  'premios', (select coalesce(json_agg(json_build_object('id', c.id, 'nome', c.nome, 'peso', c.peso, 'min', c.pastas_minimas) order by c.ordem, c.nome), '[]')
              from roleta_premios_catalogo c, k where c.org_id = k.org and c.ativo),
  'rumo', (select coalesce(json_object_agg(uid, n), '{}') from rumo),
  'alertas', (select coalesce(json_agg(json_build_object('id', a.id, 'ts', a.ts, 'tipo', a.tipo, 'uid', a.uid, 'detalhe', a.detalhe, 'valor', a.valor) order by a.ts desc), '[]')
              from (select * from alertas order by ts desc limit 60) a),
  'pessoas', (select coalesce(json_object_agg(pr.user_id, json_build_object('nome', pr.full_name, 'foto', pr.avatar_url)), '{}')
              from profiles pr where pr.user_id in (select uid from sellers union select uid from alertas union select uid from giros union select uid from rumo))
) as data
`;
