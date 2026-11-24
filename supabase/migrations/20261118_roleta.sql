-- Roleta de premiação da Civita Auxílio: estado atual do banco (projeto Supabase SalesEnablement / Vertto).
-- JÁ APLICADO em produção em 18/11/2026 (migrations roleta_premiacoes_civita, roleta_premio_pastas_minimas,
-- roleta_config_inicio). Este arquivo é a referência consolidada; não rode de novo em produção.
--
-- Regra: a cada 3 pastas pagas (pedido_itens.pago_em) de um vendedor na mesma semana (seg–dom, horário de SP)
-- nasce 1 giro, com o prêmio sorteado no banco (ponderado por peso). Prêmios com pastas_minimas só entram
-- no sorteio quando o vendedor atinge essa quantidade de pastas na semana (Day off: 15, peso 7 = 30% menos).
-- Só contam pastas pagas a partir de roleta_config.inicio_em (roleta zerada em 18/11/2026 18:01 SP).

create table public.roleta_premios_catalogo (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  nome text not null,
  peso integer not null default 1 check (peso > 0),
  pastas_minimas integer not null default 0 check (pastas_minimas >= 0),
  ativo boolean not null default true,
  ordem integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.roleta_giros (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  user_id uuid not null,
  semana date not null,
  numero integer not null,
  premio_id uuid references public.roleta_premios_catalogo(id),
  premio_nome text not null,              -- retrato do prêmio no momento do sorteio
  ultima_pasta_paga_em timestamptz,
  gerado_em timestamptz not null default now(),
  entregue boolean not null default false,
  entregue_em timestamptz,
  entregue_por uuid,
  observacao text,
  unique (org_id, user_id, semana, numero)
);

create table public.roleta_pastas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  pedido_item_id bigint not null unique references public.pedido_itens(id),
  deal_id uuid not null,
  user_id uuid,                            -- dono do negócio no momento da venda
  pago_em timestamptz not null,
  valor numeric,
  semana date not null,
  giro_id uuid references public.roleta_giros(id),
  created_at timestamptz not null default now()
);

create table public.roleta_config (
  org_id uuid primary key references public.organizations(id),
  inicio_em timestamptz not null,
  updated_at timestamptz not null default now()
);

create index roleta_pastas_pend_idx on public.roleta_pastas (org_id, user_id, semana) where giro_id is null;
create index roleta_giros_org_sem_idx on public.roleta_giros (org_id, semana);

-- sem políticas: só o banco (postgres / service role) lê e escreve
alter table public.roleta_premios_catalogo enable row level security;
alter table public.roleta_giros enable row level security;
alter table public.roleta_pastas enable row level security;
alter table public.roleta_config enable row level security;

create or replace function public.roleta_sincronizar(p_org uuid default '1ae9d44a-5a9b-4c8b-b184-0f31e1ca3cfc')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_novos integer := 0;
  r record;
  v_premio record;
  v_giro uuid;
  v_num integer;
  v_inicio timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('roleta_sincronizar:' || p_org::text));

  select inicio_em into v_inicio from roleta_config where org_id = p_org;
  if v_inicio is null then return 0; end if;

  insert into roleta_pastas (org_id, pedido_item_id, deal_id, user_id, pago_em, valor, semana)
  select p_org, pi.id, d.id, d.owner_id, pi.pago_em, pi.valor,
         date_trunc('week', pi.pago_em at time zone 'America/Sao_Paulo')::date
  from pedido_itens pi
  join deals d on d.id = pi.origem_deal_id
  where d.org_id = p_org and pi.pago_em is not null and pi.pago_em >= v_inicio
  on conflict (pedido_item_id) do nothing;

  loop
    select rp.user_id, rp.semana into r
    from roleta_pastas rp
    where rp.org_id = p_org and rp.giro_id is null and rp.user_id is not null
    group by rp.user_id, rp.semana
    having count(*) >= 3
    order by min(rp.pago_em)
    limit 1;
    exit when not found;

    select coalesce(max(g.numero), 0) + 1 into v_num
    from roleta_giros g where g.org_id = p_org and g.user_id = r.user_id and g.semana = r.semana;

    v_premio := null;
    select c.id, c.nome into v_premio
    from roleta_premios_catalogo c
    where c.org_id = p_org and c.ativo and c.pastas_minimas <= v_num * 3
    order by -ln(greatest(random(), 1e-12)) / c.peso
    limit 1;

    insert into roleta_giros (org_id, user_id, semana, numero, premio_id, premio_nome)
    values (p_org, r.user_id, r.semana, v_num, v_premio.id, coalesce(v_premio.nome, 'Prêmio a definir'))
    returning id into v_giro;

    with t as (
      select id from roleta_pastas
      where org_id = p_org and user_id = r.user_id and semana = r.semana and giro_id is null
      order by pago_em, pedido_item_id
      limit 3
    )
    update roleta_pastas x set giro_id = v_giro from t where x.id = t.id;

    update roleta_giros set ultima_pasta_paga_em = (select max(pago_em) from roleta_pastas where giro_id = v_giro)
    where id = v_giro;

    v_novos := v_novos + 1;
  end loop;

  return v_novos;
end;
$$;

revoke execute on function public.roleta_sincronizar(uuid) from public, anon, authenticated;

-- roda a cada minuto
select cron.schedule('roleta-civita-sync', '* * * * *', $cron$select public.roleta_sincronizar()$cron$);
