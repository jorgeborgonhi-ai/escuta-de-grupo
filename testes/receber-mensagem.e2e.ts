// Teste ponta a ponta da função receber-mensagem: sobe um falso PostgREST e uma
// falsa Evolution, roda a função de verdade (subprocesso Deno) e manda avisos.
// Uso, da raiz do repositório: deno run -A testes/receber-mensagem.e2e.ts
// (portas usadas: 8000, 54321 e 54322)

const FUNCAO = Deno.args[0] ?? new URL("../escuta-de-grupo/receber-mensagem.ts", import.meta.url).pathname;
const SEGREDO = "segredo-de-teste-123";
const CHAVE_EVO = "chave-evo-teste";

// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;
const mensagens = new Map<string, Obj>();
const grupos = new Map<string, Obj>();
const preferUpsertMensagens: string[] = [];
let chamadasEvolution = 0;
const chavesVistas: string[] = [];
const naoRegistrar = new Set<string>();
let naoRegistrarQuebrado = false;

const banco = Deno.serve({ port: 54321, onListen() {} }, async (req) => {
  const u = new URL(req.url);
  const tabela = u.pathname.replace("/rest/v1/", "");
  chavesVistas.push(req.headers.get("apikey") ?? "");
  if (req.method === "POST") {
    const corpo = await req.json();
    const linhas = Array.isArray(corpo) ? corpo : [corpo];
    const prefer = req.headers.get("prefer") ?? "";
    if (tabela === "mensagens") {
      preferUpsertMensagens.push(prefer);
      for (const l of linhas) {
        if (prefer.includes("ignore-duplicates") && mensagens.has(l.id)) continue;
        mensagens.set(l.id, l);
      }
    } else if (tabela === "grupos") {
      for (const l of linhas) grupos.set(l.id, { ...grupos.get(l.id), ...l });
    }
    return new Response(null, { status: 201 });
  }
  if (req.method === "GET" && tabela === "nao_registrar") {
    if (naoRegistrarQuebrado) return new Response(JSON.stringify({ message: "relation does not exist" }), { status: 404 });
    const filtro = (u.searchParams.get("autor_id") ?? "").replace(/^in\.\(/, "").replace(/\)$/, "");
    const ids = filtro.split(",").map((x) => x.replace(/^"|"$/g, ""));
    return Response.json(ids.filter((id) => naoRegistrar.has(id)).map((autor_id) => ({ autor_id })));
  }
  if (req.method === "GET" && tabela === "grupos") {
    const id = (u.searchParams.get("id") ?? "").replace(/^eq\./, "");
    const g = grupos.get(id);
    const linhas = g ? [{ nome: g.nome ?? null, atualizado_em: g.atualizado_em }] : [];
    const accept = req.headers.get("accept") ?? "";
    if (accept.includes("vnd.pgrst.object")) {
      return linhas.length ? Response.json(linhas[0]) : new Response(JSON.stringify({ code: "PGRST116" }), { status: 406 });
    }
    return Response.json(linhas);
  }
  return new Response("rota inesperada no falso banco: " + req.method + " " + u.pathname, { status: 500 });
});

const evolution = Deno.serve({ port: 54322, onListen() {} }, (req) => {
  const u = new URL(req.url);
  chamadasEvolution++;
  if (req.headers.get("apikey") !== CHAVE_EVO) return new Response("sem chave", { status: 401 });
  if (u.pathname === "/group/findGroupInfos/escuta" && u.searchParams.get("groupJid") === "120363000000000001@g.us") {
    return Response.json({ id: "120363000000000001@g.us", subject: "Cliente Exemplo | Projeto" });
  }
  return new Response("não achei", { status: 404 });
});

async function subirFuncao(env: Record<string, string>) {
  const proc = new Deno.Command("deno", {
    args: ["run", "--allow-net", "--allow-env", FUNCAO],
    env: { SUPABASE_URL: "http://localhost:54321", SUPABASE_SERVICE_ROLE_KEY: "chave-falsa", ...env },
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  for (let i = 0; i < 100; i++) {
    try {
      await fetch("http://localhost:8000", { method: "OPTIONS" }).then((r) => r.body?.cancel());
      return proc;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("a função não subiu");
}

async function avisar(corpo: unknown, cabecalhos: Record<string, string> = { "x-webhook-secret": SEGREDO }, metodo = "POST") {
  const r = await fetch("http://localhost:8000", {
    method: metodo,
    headers: { "Content-Type": "application/json", ...cabecalhos },
    body: metodo === "POST" ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
}

const GRUPO = "120363000000000001@g.us";
const base = (id: string, message: Obj, extra: Obj = {}) => ({
  event: "messages.upsert",
  instance: "escuta",
  apikey: "TOKEN-DA-INSTANCIA-NAO-PODE-IR-PRO-BANCO",
  date_time: "2026-10-11T10:00:00.000Z",
  sender: "5511999999999@s.whatsapp.net",
  server_url: "http://localhost:8080",
  data: {
    key: { remoteJid: GRUPO, fromMe: false, id, participant: "123456789012345@lid", participantAlt: "5511988887777@s.whatsapp.net" },
    pushName: "Ana Cliente",
    message,
    messageType: "conversation",
    messageTimestamp: 1791712800,
    ...extra,
  },
});

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "✔" : "✖"} ${nome}${ok ? "" : "  → " + JSON.stringify(detalhe)}`);
  if (!ok) falhas++;
}

// --- Rodada 1: com segredo configurado ---
let proc = await subirFuncao({ WEBHOOK_SECRET: SEGREDO, EVOLUTION_URL: "http://localhost:54322/", EVOLUTION_API_KEY: CHAVE_EVO });

confere("sem cabeçalho → 401", (await avisar(base("A1", { conversation: "oi" }), {})).status === 401);
confere("segredo errado → 401", (await avisar(base("A1", { conversation: "oi" }), { "x-webhook-secret": "errado" })).status === 401);
confere("GET → 405", (await avisar(null, { "x-webhook-secret": SEGREDO }, "GET")).status === 405);
confere("nada gravado por quem não tinha o segredo", mensagens.size === 0);

let r = await avisar(base("M1", { conversation: "Preciso que a arte saia até sexta, pode ser?" }));
let m = mensagens.get("M1");
confere("texto de grupo → 200 e gravado", r.status === 200 && m?.texto === "Preciso que a arte saia até sexta, pode ser?" && m?.tipo === "texto", { r, m });
confere("autor pelo telefone (participantAlt) em vez do @lid", m?.autor_id === "5511988887777@s.whatsapp.net", m?.autor_id);
confere("nome de quem mandou", m?.autor_nome === "Ana Cliente");
confere("hora pela messageTimestamp", m?.enviada_em === new Date(1791712800 * 1000).toISOString(), m?.enviada_em);
confere("a chave da instância não vai pro banco", m && !("apikey" in m.bruto) && !JSON.stringify(m.bruto).includes("TOKEN-DA-INSTANCIA"));
confere("nome do grupo buscado na Evolution", grupos.get(GRUPO)?.nome === "Cliente Exemplo | Projeto", grupos.get(GRUPO));
confere("upsert pede pra ignorar repetida", preferUpsertMensagens.at(-1)?.includes("resolution=ignore-duplicates") ?? false, preferUpsertMensagens.at(-1));

const evoAntes = chamadasEvolution;
await avisar(base("M1", { conversation: "TEXTO TROCADO NA REPETIÇÃO" }));
confere("aviso repetido não sobrescreve", mensagens.get("M1")?.texto === "Preciso que a arte saia até sexta, pode ser?");
confere("nome do grupo não é buscado de novo no mesmo dia", chamadasEvolution === evoAntes, { antes: evoAntes, depois: chamadasEvolution });

const privado = base("P1", { conversation: "mensagem privada" });
privado.data.key.remoteJid = "5511977776666@s.whatsapp.net";
r = await avisar(privado);
confere("conversa privada → ignorada", r.status === 200 && r.corpo?.ignorada === true && !mensagens.has("P1"), r);

r = await avisar({ event: "connection.update", instance: "escuta", data: { state: "open" } });
confere("outro evento → ignorado sem erro", r.status === 200 && r.corpo?.ignorada === true, r);

r = await avisar({ ...base("U1", { conversation: "evento em maiúsculo" }), event: "MESSAGES_UPSERT" });
confere("evento escrito MESSAGES_UPSERT também vale", mensagens.get("U1")?.texto === "evento em maiúsculo");

await avisar(base("ALB1", { associatedChildMessage: { message: { imageMessage: { caption: "foto 2 do álbum", mimetype: "image/jpeg" } } } }, { messageType: "associatedChildMessage" }));
confere("foto de álbum: abre o envelope e pega a legenda", mensagens.get("ALB1")?.tipo === "imagem" && mensagens.get("ALB1")?.texto === "foto 2 do álbum", mensagens.get("ALB1"));

await avisar(base("EPH1", { ephemeralMessage: { message: { extendedTextMessage: { text: "respondendo aqui", contextInfo: { stanzaId: "M1", participant: "123@lid" } } } } }));
confere("mensagem temporária + resposta citada", mensagens.get("EPH1")?.texto === "respondendo aqui" && mensagens.get("EPH1")?.referencia_id === "M1", mensagens.get("EPH1"));

await avisar(base("DOC1", { documentWithCaptionMessage: { message: { documentMessage: { fileName: "orcamento.pdf", caption: "segue o orçamento" } } } }));
confere("documento com legenda", mensagens.get("DOC1")?.tipo === "documento" && mensagens.get("DOC1")?.texto === "orcamento.pdf: segue o orçamento", mensagens.get("DOC1"));

await avisar(base("AUD1", { audioMessage: { seconds: 12, ptt: true } }));
confere("áudio vira tipo audio sem texto", mensagens.get("AUD1")?.tipo === "audio" && mensagens.get("AUD1")?.texto === null);

await avisar(base("ED1", { secretEncryptedMessage: { secretEncType: 2, targetMessageKey: { id: "M1" } } }));
confere("edição cifrada: registra a edição sem texto", mensagens.get("ED1")?.tipo === "edicao" && mensagens.get("ED1")?.texto === null && mensagens.get("ED1")?.referencia_id === "M1", mensagens.get("ED1"));

await avisar(base("ED2", { protocolMessage: { type: "MESSAGE_EDIT", key: { id: "M1" }, editedMessage: { conversation: "Na verdade pode ser segunda" } } }));
confere("edição aberta: guarda o texto novo", mensagens.get("ED2")?.tipo === "edicao" && mensagens.get("ED2")?.texto === "Na verdade pode ser segunda" && mensagens.get("ED2")?.referencia_id === "M1", mensagens.get("ED2"));

await avisar(base("DEL1", { protocolMessage: { type: 0, key: { id: "M1" } } }));
confere("mensagem apagada", mensagens.get("DEL1")?.tipo === "apagada" && mensagens.get("DEL1")?.referencia_id === "M1", mensagens.get("DEL1"));

await avisar(base("REA1", { reactionMessage: { text: "👍", key: { id: "M1" } } }));
confere("reação aponta pra mensagem", mensagens.get("REA1")?.tipo === "reacao" && mensagens.get("REA1")?.texto === "👍" && mensagens.get("REA1")?.referencia_id === "M1");

await avisar(base("ENQ1", { pollCreationMessageV3: { name: "Qual horário?", options: [{ optionName: "9h" }, { optionName: "14h" }] } }));
confere("enquete com opções", mensagens.get("ENQ1")?.texto === "Qual horário?\n- 9h\n- 14h", mensagens.get("ENQ1")?.texto);

await avisar(base("TS1", { conversation: "hora como texto" }, { messageTimestamp: "1791712900" }));
confere("hora vinda como texto", mensagens.get("TS1")?.enviada_em === new Date(1791712900 * 1000).toISOString());
await avisar(base("TS2", { conversation: "hora como low/high" }, { messageTimestamp: { low: 1791713000, high: 0, unsigned: true } }));
confere("hora vinda como {low, high}", mensagens.get("TS2")?.enviada_em === new Date(1791713000 * 1000).toISOString());

const meu = base("ME1", { conversation: "mandei do número de escuta" }, { pushName: "Número Escuta" });
meu.data.key.fromMe = true;
await avisar(meu);
confere("mensagem do próprio número: de_mim e sem nome", mensagens.get("ME1")?.de_mim === true && mensagens.get("ME1")?.autor_nome === null);

const semAlt = base("LID1", { conversation: "sem telefone" });
delete semAlt.data.key.participantAlt;
await avisar(semAlt);
confere("sem participantAlt, guarda o @lid", mensagens.get("LID1")?.autor_id === "123456789012345@lid");

r = await avisar({ event: "messages.upsert", data: {} });
confere("aviso sem chave de mensagem → ignorado", r.status === 200 && r.corpo?.ignorada === true);

// Texto citado numa resposta não fica guardado (só o id da citada)
await avisar(base("CIT1", { extendedTextMessage: { text: "concordo", contextInfo: { stanzaId: "M1", participant: "222@lid", quotedMessage: { conversation: "TEXTO CITADO DE OUTRA PESSOA" } } } }, { contextInfo: { stanzaId: "M1", quotedMessage: { conversation: "TEXTO CITADO DE OUTRA PESSOA" } } }));
confere("resposta guarda o id da citada", mensagens.get("CIT1")?.referencia_id === "M1", mensagens.get("CIT1"));
confere("o texto citado não fica guardado no bruto", !JSON.stringify(mensagens.get("CIT1")?.bruto ?? {}).includes("TEXTO CITADO"), mensagens.get("CIT1")?.bruto);

// Nome do grupo pelo evento de entrada no grupo (GROUPS_UPSERT)
const GRUPO2 = "120363000000000002@g.us";
let evoAntesGrupo = chamadasEvolution;
r = await avisar({ event: "groups.upsert", instance: "escuta", data: [{ id: GRUPO2, subject: "Grupo Novo do Cliente", size: 3 }] });
confere("groups.upsert grava o nome do grupo", r.status === 200 && grupos.get(GRUPO2)?.nome === "Grupo Novo do Cliente", grupos.get(GRUPO2));
confere("groups.upsert não vira mensagem", ![...mensagens.values()].some((x) => x.grupo_id === GRUPO2));
await avisar({ ...base("G2M1", { conversation: "primeira mensagem no grupo novo" }), data: { ...base("G2M1", { conversation: "primeira mensagem no grupo novo" }).data, key: { remoteJid: GRUPO2, fromMe: false, id: "G2M1", participant: "1@lid" } } });
confere("grupo com nome recente: não pergunta à Evolution", chamadasEvolution === evoAntesGrupo && grupos.get(GRUPO2)?.nome === "Grupo Novo do Cliente", { chamadas: chamadasEvolution - evoAntesGrupo, g: grupos.get(GRUPO2) });
r = await avisar({ event: "GROUPS_UPSERT", instance: "escuta", data: { id: GRUPO2 } });
confere("groups.upsert sem nome não apaga o nome que já existe", grupos.get(GRUPO2)?.nome === "Grupo Novo do Cliente", grupos.get(GRUPO2));
r = await avisar({ event: "groups.upsert", instance: "escuta", data: { id: "120363000000000003@g.us", subject: "Veio como objeto" } });
confere("groups.upsert com um grupo só (objeto, não lista)", grupos.get("120363000000000003@g.us")?.nome === "Veio como objeto");
r = await avisar({ event: "groups.upsert", instance: "escuta", data: [{ id: "5511999999999@s.whatsapp.net", subject: "não é grupo" }] });
confere("groups.upsert ignora o que não é grupo", !grupos.has("5511999999999@s.whatsapp.net"));

// Quem pediu pra não ser registrado (tabela nao_registrar)
naoRegistrar.add("5511955554444@s.whatsapp.net");
naoRegistrar.add("999999999999999@lid");
const pediu = base("NR1", { conversation: "não quero ser registrado" });
pediu.data.key.participantAlt = "5511955554444@s.whatsapp.net";
pediu.data.key.participant = "222222222222222@lid";
r = await avisar(pediu);
confere("não registrar: pelo telefone, a mensagem não é guardada", r.status === 200 && !mensagens.has("NR1"), r);
const pediuLid = base("NR2", { conversation: "só com o @lid" });
pediuLid.data.key.participant = "999999999999999@lid";
pediuLid.data.key.participantAlt = "5511900000000@s.whatsapp.net";
r = await avisar(pediuLid);
confere("não registrar: pelo @lid também", r.status === 200 && !mensagens.has("NR2"), r);
r = await avisar(base("NR3", { conversation: "outra pessoa segue normal" }));
confere("não registrar: quem não está na lista é guardado", mensagens.has("NR3"));
naoRegistrarQuebrado = true;
r = await avisar(base("NR4", { conversation: "lista fora do ar" }));
confere("lista de não registrar fora do ar: não guarda e devolve erro", r.status === 500 && !mensagens.has("NR4"), r);
naoRegistrarQuebrado = false;
naoRegistrar.clear();

const lixo = await fetch("http://localhost:8000", { method: "POST", headers: { "x-webhook-secret": SEGREDO }, body: "não é json" });
confere("corpo que não é JSON → 400", lixo.status === 400);
await lixo.body?.cancel();

proc.kill();
const saida1 = new TextDecoder().decode((await proc.output()).stderr);
confere("recusa por segredo aparece no histórico (Logs) da função", saida1.includes("segredo do webhook não confere"), saida1.slice(0, 300));
confere("o histórico não mostra o segredo", !saida1.includes(SEGREDO) && !saida1.includes("errado"));

// --- Rodada 2: esqueceram de cadastrar o segredo ---
proc = await subirFuncao({});
const antes = mensagens.size;
r = await avisar(base("X1", { conversation: "sem segredo configurado" }), { "x-webhook-secret": "" });
confere("sem WEBHOOK_SECRET configurado, recusa tudo (401)", r.status === 401 && mensagens.size === antes, r);
r = await avisar(base("X2", { conversation: "sem segredo configurado" }), { "x-webhook-secret": "qualquer" });
confere("sem WEBHOOK_SECRET, nem com cabeçalho preenchido passa", r.status === 401);
proc.kill();
const saida2 = new TextDecoder().decode((await proc.output()).stderr);
confere("sem WEBHOOK_SECRET, o histórico diz que falta cadastrar", saida2.includes("WEBHOOK_SECRET não está cadastrado"), saida2.slice(0, 300));

// --- Rodada 3: sem dados da Evolution, a mensagem grava e o grupo fica sem nome ---
grupos.clear();
proc = await subirFuncao({ WEBHOOK_SECRET: SEGREDO });
r = await avisar(base("N1", { conversation: "sem Evolution configurada" }));
confere("sem EVOLUTION_URL: grava a mensagem mesmo assim", r.status === 200 && mensagens.has("N1"));
confere("e cria o grupo sem nome (tenta de novo depois)", grupos.has(GRUPO) && grupos.get(GRUPO)?.nome === null, grupos.get(GRUPO));
proc.kill();
await proc.status;

// --- Rodada 4: projeto novo, só com SUPABASE_SECRET_KEYS ---
chavesVistas.length = 0;
proc = await subirFuncao({ WEBHOOK_SECRET: SEGREDO, SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_nova" }) });
r = await avisar(base("K1", { conversation: "chave nova" }));
confere("projeto novo: usa a chave de SUPABASE_SECRET_KEYS", r.status === 200 && mensagens.has("K1") && chavesVistas.includes("sb_secret_nova"), chavesVistas);
proc.kill();
await proc.status;

// --- Rodada 6: segredo colado com espaço ou quebra de linha nas pontas ---
proc = await subirFuncao({ WEBHOOK_SECRET: ` ${SEGREDO}\n` });
r = await avisar(base("ESP1", { conversation: "segredo com espaço no Supabase" }));
confere("espaço/quebra de linha nas pontas do segredo não derrubam", r.status === 200 && mensagens.has("ESP1"), r);
r = await avisar(base("ESP2", { conversation: "outro segredo" }), { "x-webhook-secret": "outra-coisa" });
confere("...mas segredo diferente continua recusado", r.status === 401 && !mensagens.has("ESP2"), r);
proc.kill();
await proc.status;
proc = await subirFuncao({ WEBHOOK_SECRET: "   " });
r = await avisar(base("ESP3", { conversation: "segredo só de espaços" }), { "x-webhook-secret": "   " });
confere("segredo só de espaços conta como não configurado (401)", r.status === 401 && !mensagens.has("ESP3"), r);
proc.kill();
await proc.status;

// --- Rodada 5: EVOLUTION_URL sem https: a chave não sai sem criptografia ---
const evoAntesHttp = chamadasEvolution;
proc = await subirFuncao({ WEBHOOK_SECRET: SEGREDO, EVOLUTION_URL: "http://0.0.0.0:54322", EVOLUTION_API_KEY: CHAVE_EVO });
const outroGrupo = base("H1", { conversation: "grupo novo, evolution em http" });
outroGrupo.data.key.remoteJid = "120363000000000009@g.us";
r = await avisar(outroGrupo);
confere("EVOLUTION_URL em http (fora do próprio computador): não manda a chave", r.status === 200 && mensagens.has("H1") && chamadasEvolution === evoAntesHttp, { chamadas: chamadasEvolution - evoAntesHttp });
proc.kill();
await proc.status;

await banco.shutdown();
await evolution.shutdown();
console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
Deno.exit(falhas ? 1 : 0);
