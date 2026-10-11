---
name: escuta-de-grupo
description: Monta com a pessoa a escuta de grupo, um número de WhatsApp nos grupos com clientes que guarda as mensagens num banco Supabase que a IA lê. Use quando pedirem pra montar isso, ou pra consertar uma parte dele (mensagem que não chega no banco, grupo sem nome, IA que não consegue ler o banco).
---

# Escuta de grupo

Conduza a montagem pelo [GUIA.md](GUIA.md) desta pasta, do começo: ele tem as etapas em ordem, os
três cuidados e a conferência de cada etapa. As Referências A, B e C do guia são os arquivos aqui do
lado (`banco.sql`, `receber-mensagem.ts`, `instrucoes-da-ia.md`): leia deles.

Pedido de conserto: vá direto à seção "Quando algo dá errado" do guia e à conferência da etapa
envolvida.

## O que muda no Claude Code

- **Você roda as conferências que não levam chave.** A tranca da função se confere assim, e tem que
  dar `401`:
  `curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://<id>.supabase.co/functions/v1/receber-mensagem" -d '{}'`
- **Comando com chave a pessoa roda, no terminal do servidor.** O da Etapa 5 leva a chave da
  Evolution e o segredo do webhook: você entrega o comando com os marcadores no lugar das chaves, e
  ela preenche lá. A resposta dele traz o segredo; peça só se apareceu `"enabled":true`.
- **Etapa 6:** o `claude mcp add` você mesmo roda (não leva chave). O login (`/mcp` → supabase →
  Authenticate) é da pessoa, no navegador.
- **Etapa 7:** o arquivo de instruções entra no `CLAUDE.md` da pasta de trabalho. Se ele já existir,
  como uma seção a mais.
- **Função pelo terminal:** se a pessoa já usa a CLI do Supabase, a Referência B pode ser publicada
  com `supabase functions deploy receber-mensagem --no-verify-jwt` (o arquivo vai em
  `supabase/functions/receber-mensagem/index.ts`), no lugar do editor do painel.
