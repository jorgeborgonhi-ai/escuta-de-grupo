# A sua IA lendo o grupo do cliente

Oi, aqui é o Jorge Borgonhi. Esse é o guia do vídeo do número de WhatsApp que fica nos grupos com
cliente e guarda as mensagens num banco de dados. Com isso montado, a sua IA chega sabendo o que o
cliente pediu, o que foi combinado e o que ficou pendente, sem você copiar conversa nenhuma.

Aí é só chegar pra ela e falar: "Meu cliente pediu isso no grupo tal. Vamos resolver."

Você não precisa saber programar. Quem faz a parte técnica é a sua IA, e você vai clicando e
colando o que ela pedir.

## Como usar

1. Abra o arquivo [`escuta-de-grupo/GUIA.md`](escuta-de-grupo/GUIA.md) e copie o texto inteiro (no
   GitHub, o botão de copiar fica no canto de cima do arquivo).
2. Cole numa conversa nova com a sua IA (Claude, ChatGPT ou Codex) e mande.
3. Ela vai perguntar o que você já tem e te levar etapa por etapa. Parou no meio? Cola o guia de novo
   outro dia e diz onde parou.

Usa o Claude Code? Dá pra instalar como skill: copie a pasta `escuta-de-grupo` pra dentro de
`~/.claude/skills/` e peça "monta a escuta de grupo comigo".

## O que você vai precisar

- **Um servidor** (aquele computador alugado que fica ligado o tempo todo). O caminho mais fácil é a
  VPS da Hostinger, que instala a Evolution com um clique, mas serve qualquer uma.
- **Um chip só pra isso**, com WhatsApp instalado num celular.
- **Uma conta no Supabase**, que é o banco de dados. O plano gratuito dá pra começar.
- **Uma IA que consiga se conectar ao banco.** O guia confere isso logo no começo, antes de você
  montar qualquer coisa.
- Umas duas ou três horas, com calma.

## Três cuidados antes de começar

1. **Nunca use o seu número principal.** Esse número não usa a conexão oficial do WhatsApp pra
   empresas, ele entra do mesmo jeito que o WhatsApp Web. O WhatsApp pode bloquear um número
   conectado assim, então é um chip separado, que só escuta.
2. **Avise o grupo que ele tá lá.** Guardar mensagem de outras pessoas pede transparência (é a LGPD).
   O guia já traz uma mensagem pronta pra você mandar quando o número entrar.
3. **Chave secreta não vai pra conversa.** Senha do banco e chave secreta você cola direto no painel
   de cada sistema, nunca no chat da IA. A IA lê o banco com um acesso só de leitura, sem chave
   nenhuma na mão dela.

## O que tem aqui

| Arquivo | Pra quê |
|---|---|
| `escuta-de-grupo/GUIA.md` | O guia que você cola na IA |
| `escuta-de-grupo/SKILL.md` | O mesmo guia como skill do Claude Code |
| `escuta-de-grupo/banco.sql` | As tabelas do banco (a IA te passa na hora certa) |
| `escuta-de-grupo/receber-mensagem.ts` | A função que recebe cada mensagem e guarda no banco |
| `escuta-de-grupo/instrucoes-da-ia.md` | O modelo do arquivo que ensina a sua IA a ler os grupos |

Pra quem mexe no código: o `GUIA.md` leva uma cópia dos três arquivos de cima, montada com
`node ferramentas/montar-guia.mjs`, e a função tem teste em `testes/` (`deno run -A
testes/receber-mensagem.e2e.ts`).

É uma receita enxuta, de propósito. Com ela rodando, dá pra ir bem mais longe, tipo montar uma
memória com o contexto de cada cliente ou um resumo da semana de cada grupo. Mas começa pelo
simples. Só isso já muda bastante coisa no dia a dia.

Me conta como ficou o seu lá no Instagram: [@jorgeborgonhi](https://instagram.com/jorgeborgonhi).
