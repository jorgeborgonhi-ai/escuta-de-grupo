-- Escuta de grupo: as tabelas que guardam as mensagens dos grupos.
-- Rode tudo de uma vez no SQL Editor do Supabase.

-- Os grupos em que o número de escuta está.
create table if not exists public.grupos (
  id text primary key,                    -- o código do grupo no WhatsApp (termina em @g.us)
  nome text,                              -- o nome do grupo, como aparece no WhatsApp
  atualizado_em timestamptz not null default now()
);

-- Uma linha por mensagem de grupo.
create table if not exists public.mensagens (
  id text primary key,                    -- o código da mensagem no WhatsApp; evita guardar repetida
  grupo_id text not null,
  autor_id text,                          -- quem mandou: telefone, ou um código terminado em @lid
  autor_nome text,                        -- o nome que a pessoa usa no WhatsApp
  de_mim boolean not null default false,  -- true quando quem mandou foi o próprio número de escuta
  tipo text not null,                     -- texto, imagem, video, audio, documento, figurinha, reacao,
                                          -- enquete, localizacao, contato, edicao, apagada, sistema, outro
  texto text,                             -- o texto ou a legenda; vazio em áudio e figurinha
  referencia_id text,                     -- a mensagem a que esta se refere (resposta, reação, edição, apagada)
  enviada_em timestamptz not null,
  recebida_em timestamptz not null default now(),
  bruto jsonb                             -- o aviso inteiro da Evolution, pra reprocessar se precisar
);

create index if not exists mensagens_por_grupo_e_data on public.mensagens (grupo_id, enviada_em desc);

-- Quem pediu pra não ter as mensagens registradas. A função confere esta
-- lista antes de guardar cada mensagem. Uma linha por código da pessoa (ela
-- pode ter dois: o telefone e um código terminado em @lid).
create table if not exists public.nao_registrar (
  autor_id text primary key,
  nome text,
  pedido_em timestamptz not null default now()
);

-- Porta fechada: só a função receber-mensagem (com a chave secreta) escreve,
-- e ninguém de fora lê pela chave pública do projeto.
alter table public.grupos enable row level security;
alter table public.mensagens enable row level security;
alter table public.nao_registrar enable row level security;
revoke all on table public.grupos, public.mensagens, public.nao_registrar from anon, authenticated;

-- A conversa pronta pra ler: mensagem com o nome do grupo.
-- security_invoker faz a visão respeitar as mesmas travas das tabelas.
create or replace view public.conversas
with (security_invoker = true) as
select
  g.nome as grupo,
  m.enviada_em,
  m.autor_nome,
  m.autor_id,
  m.de_mim,
  m.tipo,
  m.texto,
  m.referencia_id,
  m.id,
  m.grupo_id
from public.mensagens m
left join public.grupos g on g.id = m.grupo_id;

revoke all on table public.conversas from anon, authenticated;
