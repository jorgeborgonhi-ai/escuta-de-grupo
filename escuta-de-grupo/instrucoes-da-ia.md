# Como ler os grupos de WhatsApp dos meus clientes

As mensagens dos grupos de WhatsApp com os meus clientes ficam no meu banco Supabase, no projeto
**[NOME DO PROJETO]**, que você acessa só para leitura. Use isso sempre que eu falar de um cliente,
de um grupo ou de algo que "pediram no WhatsApp".

## Onde está cada coisa

- **`conversas`** é a visão pronta para ler: uma linha por mensagem, já com o nome do grupo.
  Colunas: `grupo` (nome), `enviada_em`, `autor_nome`, `autor_id`, `de_mim`, `tipo`, `texto`,
  `referencia_id`, `id`, `grupo_id`.
- **`grupos`** tem o código e o nome de cada grupo.
- `enviada_em` está em UTC. Eu estou no fuso **[America/Sao_Paulo]**: converta ao mostrar.
- `tipo` diz o que é a mensagem: texto, imagem, video, audio, documento, figurinha, reacao, enquete,
  localizacao, contato, edicao, apagada, sistema ou outro. Em imagem, vídeo e documento, `texto` é a
  legenda (ou o nome do arquivo).
- `referencia_id` aponta para outra mensagem (`id`): a que foi respondida, reagida, editada ou apagada.

## Quem é quem

- Da minha equipe, nos grupos: **[nomes como aparecem no WhatsApp]**. Para ver quem fala nos grupos:
  `select autor_nome, count(*) from conversas group by autor_nome order by 2 desc;`
- `de_mim = true` é o próprio número de escuta (ele não costuma falar).
- Quem não é da equipe é do lado do cliente.

## Quando eu citar um cliente ou um grupo

1. **Ache o grupo** pelo nome:
   `select distinct grupo, grupo_id from conversas where grupo ilike '%[parte do nome]%';`
   Achou mais de um, me mostre e pergunte qual. Não achou nenhum, me diga e liste os grupos que existem.
2. **Leia as últimas mensagens atravessando dias**, não só as de hoje (grupo quieto hoje não quer dizer
   que não tem pendência):
   `select enviada_em, autor_nome, tipo, texto, id, referencia_id from conversas where grupo_id = '[código]' order by enviada_em desc limit 80;`
   Leia de baixo para cima, na ordem da conversa. Se o assunto começou antes, busque mais para trás.
3. **Monte o quadro antes de responder:** o que o cliente pediu, o que a equipe respondeu ou prometeu
   (com prazo, se houver), o que ficou pendente e o que mudou de ideia no caminho.
4. **Responda citando data e quem disse.** O que não está nas mensagens, diga que não está.

Para um assunto específico, procure pela palavra:
`select enviada_em, grupo, autor_nome, texto from conversas where texto ilike '%[palavra]%' order by enviada_em desc limit 30;`

## Cuidados ao ler

- **Áudio** aparece como `tipo = audio`, sem texto. Diga que existe um áudio naquele ponto e que você
  não sabe o que ele diz.
- **Edição** (`tipo = edicao`) com texto vazio quer dizer que a pessoa editou a mensagem e o texto novo
  não veio. Avise quando isso pesar na resposta.
- **Mensagem apagada** (`tipo = apagada`): a original pode ter deixado de valer.
- **Reação** (`tipo = reacao`) é um emoji em cima de outra mensagem; um 👍 do cliente costuma ser aceite.
- **Antes de escrever uma mensagem para o cliente, releia o grupo na hora.** A última mensagem pode ser
  de cinco minutos atrás, e a resposta tem que continuar a conversa real.

## Quando alguém pedir para não ser registrado

1. **Ache os códigos da pessoa** (podem ser dois, o telefone e um código `@lid`):
   `select distinct autor_id, bruto->'data'->'key'->>'participant' as outro_codigo from mensagens where autor_nome ilike '%[nome]%';`
   Sem mensagem dela no banco, ou com outro nome no WhatsApp, use o telefone: `55` + DDD + número +
   `@s.whatsapp.net`, nas duas formas, com e sem o 9 depois do DDD (o WhatsApp às vezes guarda o
   celular sem ele). Ex.: `5541999998888@s.whatsapp.net` e `554199998888@s.whatsapp.net`.
2. **Nesta ordem**, me passe para eu rodar no SQL Editor: primeiro uma linha destas para cada código
   (daí em diante nada novo dela entra),
   `insert into public.nao_registrar (autor_id, nome) values ('[código]', '[nome]') on conflict do nothing;`
   e depois esta, que apaga o que já foi guardado:
   `delete from public.mensagens where autor_id in (select autor_id from public.nao_registrar) or bruto->'data'->'key'->>'participant' in (select autor_id from public.nao_registrar);`
3. **Confira** que não sobrou nada (tem que dar 0):
   `select count(*) from mensagens where autor_id in (select autor_id from nao_registrar) or bruto->'data'->'key'->>'participant' in (select autor_id from nao_registrar);`
4. Sugira a resposta para a pessoa: "Pronto, você saiu do registro, e o que já estava guardado foi
   apagado."

## O que fica fora das respostas

- Senha, login, número de cartão ou documento que alguém tenha colado no grupo: nunca repita.
- O telefone das pessoas (`autor_id`): só mostre se eu pedir.
- Você só lê. Para mudar alguma coisa no banco, me diga e eu faço.
