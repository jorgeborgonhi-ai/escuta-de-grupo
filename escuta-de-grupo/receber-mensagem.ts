// Função "receber-mensagem" (Supabase Edge Function).
//
// A Evolution API chama este endereço a cada novidade do número de escuta. A
// função guarda só as mensagens de GRUPO (conversa privada com o número é
// ignorada e não fica registrada) e o nome de cada grupo em que ele entra.
// Quem está na tabela nao_registrar não tem as mensagens guardadas.
//
// Segredo que você cadastra em Edge Functions > Secrets:
//   WEBHOOK_SECRET     o mesmo valor do cabeçalho x-webhook-secret no webhook da Evolution
// Opcionais, só se o endereço da sua Evolution começa com https:// (servem pra
// pegar o nome de grupo antigo e de grupo renomeado):
//   EVOLUTION_URL      ex.: https://evolution.seudominio.com.br
//   EVOLUTION_API_KEY  a chave da Evolution
// O endereço do banco e a chave secreta dele já existem dentro da função: você
// não cadastra nem cola essa chave em lugar nenhum.

import { createClient } from "npm:@supabase/supabase-js@2";

const banco = createClient(Deno.env.get("SUPABASE_URL")!, chaveSecretaDoBanco(), {
  auth: { persistSession: false },
});

// Projeto novo traz a chave em SUPABASE_SECRET_KEYS; projeto antigo, em
// SUPABASE_SERVICE_ROLE_KEY. Serve qualquer um dos dois.
function chaveSecretaDoBanco(): string {
  try {
    const nova = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}")?.default;
    if (typeof nova === "string" && nova) return nova;
  } catch {
    // formato inesperado: cai na chave antiga
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return resposta(405, { erro: "use POST" });
  if (!(await segredoConfere(req.headers.get("x-webhook-secret")))) {
    return resposta(401, { erro: "segredo inválido" });
  }

  let aviso: Obj;
  try {
    aviso = await req.json();
  } catch {
    return resposta(400, { erro: "o corpo não é JSON" });
  }

  if (nomeDoEvento(aviso) === "groups.upsert") {
    await guardarGruposDoAviso(aviso.data);
    return resposta(200, { ok: true });
  }

  const linha = montarLinha(aviso);
  if (!linha) return resposta(200, { ok: true, ignorada: true });

  // Quem pediu pra não ser registrado não entra no banco. Se a lista não
  // responde, a mensagem também não entra: na dúvida, vale o pedido da pessoa.
  try {
    if (await pediuParaNaoRegistrar(idsDoAutor(aviso))) return resposta(200, { ok: true, ignorada: true });
  } catch (e) {
    console.error("não deu pra conferir a lista nao_registrar:", (e as Error).message);
    return resposta(500, { erro: "falha ao conferir a lista nao_registrar" });
  }

  // A Evolution pode mandar o mesmo aviso duas vezes: o id da mensagem é a
  // chave, e a repetida é descartada sem erro.
  const { error } = await banco
    .from("mensagens")
    .upsert(linha, { onConflict: "id", ignoreDuplicates: true });
  if (error) {
    console.error("falha ao gravar a mensagem:", error.message);
    return resposta(500, { erro: "falha ao gravar" });
  }

  await guardarNomeDoGrupo(String(aviso.instance ?? ""), linha.grupo_id);
  return resposta(200, { ok: true });
});

// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;

// O WhatsApp embrulha a mensagem em "envelopes" (mensagem temporária, ver uma
// vez, documento com legenda, cada foto de um álbum...). O conteúdo de verdade
// fica lá dentro; sem abrir, a legenda de uma foto de álbum vira texto vazio.
const ENVELOPES = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "documentWithCaptionMessage",
  "associatedChildMessage",
  "editedMessage",
  "deviceSentMessage",
];

function desembrulhar(mensagem: Obj): Obj {
  let m = mensagem;
  for (let i = 0; i < 6 && m && typeof m === "object"; i++) {
    const envelope = ENVELOPES.find((k) => m[k]?.message);
    if (!envelope) break;
    m = m[envelope].message;
  }
  return m ?? {};
}

// O evento chega como "messages.upsert" ou como "MESSAGES_UPSERT".
function nomeDoEvento(aviso: Obj): string {
  return String(aviso?.event ?? "").toLowerCase().replaceAll("_", ".");
}

function montarLinha(aviso: Obj) {
  if (nomeDoEvento(aviso) !== "messages.upsert") return null;

  const dados = aviso.data ?? {};
  const chave = dados.key ?? {};
  const grupoId = chave.remoteJid;
  // Grupo do WhatsApp termina em @g.us. Conversa privada, status e canal ficam de fora.
  if (typeof grupoId !== "string" || !grupoId.endsWith("@g.us")) return null;
  if (typeof chave.id !== "string" || !chave.id) return null;

  const conteudo = lerConteudo(desembrulhar(dados.message ?? {}));
  const deMim = chave.fromMe === true;

  return {
    id: chave.id,
    grupo_id: grupoId,
    // O WhatsApp passou a esconder o telefone atrás de um código que termina em
    // @lid. Quando a Evolution traz o telefone no campo "Alt", ele vale mais.
    autor_id: chave.participantAlt ?? chave.participant ?? null,
    // Na mensagem mandada pelo próprio número, o pushName é o nome DELE.
    autor_nome: deMim ? null : (String(dados.pushName ?? "").trim() || null),
    de_mim: deMim,
    tipo: conteudo.tipo,
    texto: conteudo.texto,
    referencia_id: conteudo.referenciaId,
    enviada_em: quando(dados.messageTimestamp, aviso.date_time),
    bruto: semChaves(aviso),
  };
}

// A mesma pessoa pode vir pelo telefone ou pelo código @lid: os dois contam.
function idsDoAutor(aviso: Obj): string[] {
  const chave = aviso?.data?.key ?? {};
  return [chave.participant, chave.participantAlt].filter((id) => typeof id === "string" && id);
}

async function pediuParaNaoRegistrar(ids: string[]): Promise<boolean> {
  if (!ids.length) return false;
  const { data, error } = await banco.from("nao_registrar").select("autor_id").in("autor_id", ids).limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

type Conteudo = { tipo: string; texto: string | null; referenciaId: string | null };

function lerConteudo(m: Obj): Conteudo {
  // Mensagem citada (a pessoa respondeu "em cima" de outra): guarda o id da original.
  const citada = Object.values(m).find((v) => v?.contextInfo?.stanzaId)?.contextInfo?.stanzaId ?? null;
  const c = (tipo: string, texto: unknown): Conteudo => ({
    tipo,
    texto: typeof texto === "string" && texto.trim() ? texto : null,
    referenciaId: citada,
  });

  // Edição de mensagem em grupo costuma vir cifrada: fica registrado que houve
  // edição, mas o texto novo não vem legível.
  const cifrada = m.secretEncryptedMessage;
  if (cifrada) {
    const edicao = cifrada.secretEncType === 2 || cifrada.secretEncType === "MESSAGE_EDIT";
    return { tipo: edicao ? "edicao" : "outro", texto: null, referenciaId: cifrada.targetMessageKey?.id ?? null };
  }
  const protocolo = m.protocolMessage;
  if (protocolo) {
    if (protocolo.type === 14 || protocolo.type === "MESSAGE_EDIT") {
      const nova = lerConteudo(desembrulhar(protocolo.editedMessage ?? {}));
      return { tipo: "edicao", texto: nova.texto, referenciaId: protocolo.key?.id ?? null };
    }
    if (protocolo.type === 0 || protocolo.type === "REVOKE") {
      return { tipo: "apagada", texto: null, referenciaId: protocolo.key?.id ?? null };
    }
    return { tipo: "sistema", texto: null, referenciaId: null };
  }

  if (typeof m.conversation === "string") return c("texto", m.conversation);
  if (m.extendedTextMessage) return c("texto", m.extendedTextMessage.text);
  if (m.imageMessage) return c("imagem", m.imageMessage.caption);
  if (m.videoMessage) return c("video", m.videoMessage.caption);
  if (m.audioMessage) return c("audio", null);
  if (m.documentMessage) {
    const doc = m.documentMessage;
    return c("documento", [doc.fileName, doc.caption].filter(Boolean).join(": "));
  }
  if (m.stickerMessage || m.lottieStickerMessage) return c("figurinha", null);
  if (m.reactionMessage) {
    return { tipo: "reacao", texto: m.reactionMessage.text || null, referenciaId: m.reactionMessage.key?.id ?? null };
  }
  const enquete = m.pollCreationMessage ?? m.pollCreationMessageV2 ?? m.pollCreationMessageV3;
  if (enquete) {
    const opcoes = (enquete.options ?? []).map((o: Obj) => `- ${o.optionName}`);
    return c("enquete", [enquete.name, ...opcoes].filter(Boolean).join("\n"));
  }
  const local = m.locationMessage ?? m.liveLocationMessage;
  if (local) return c("localizacao", [local.name, local.address].filter(Boolean).join(", "));
  if (m.contactMessage) return c("contato", m.contactMessage.displayName);
  return c("outro", null);
}

// A hora vem em segundos, às vezes como texto, às vezes como {low, high}.
function quando(ts: unknown, reserva: unknown): string {
  const segundos = ts && typeof ts === "object" ? Number((ts as Obj).low) : Number(ts);
  if (Number.isFinite(segundos) && segundos > 0) return new Date(segundos * 1000).toISOString();
  const r = Date.parse(String(reserva ?? ""));
  return new Date(Number.isFinite(r) ? r : Date.now()).toISOString();
}

// O aviso da Evolution pode trazer a chave da instância no campo "apikey". Ela
// controla o seu número, então nunca entra no banco que a IA lê. O texto citado
// numa resposta também sai: a original já está guardada (referencia_id), e uma
// cópia aqui sobreviveria ao pedido de não registro de quem foi citado.
function semChaves(aviso: Obj): Obj {
  const { apikey: _chave, ...resto } = aviso;
  return semCitacao(resto) as Obj;
}

function semCitacao(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(semCitacao);
  if (!valor || typeof valor !== "object") return valor;
  return Object.fromEntries(
    Object.entries(valor).filter(([k]) => k !== "quotedMessage").map(([k, v]) => [k, semCitacao(v)]),
  );
}

// Quando o número entra num grupo, a Evolution avisa com o nome dele.
async function guardarGruposDoAviso(dados: unknown) {
  const lista = (Array.isArray(dados) ? dados : [dados]) as Obj[];
  const agora = new Date().toISOString();
  const linhas = lista
    .filter((g) => typeof g?.id === "string" && g.id.endsWith("@g.us"))
    .filter((g) => typeof g.subject === "string" && g.subject.trim())
    .map((g) => ({ id: g.id, nome: g.subject.trim(), atualizado_em: agora }));
  if (!linhas.length) return;
  const { error } = await banco.from("grupos").upsert(linhas, { onConflict: "id" });
  if (error) console.error("falha ao gravar o nome do grupo:", error.message);
}

// A mensagem não traz o nome do grupo. Grupo novo entra na lista na primeira
// mensagem; o nome vem do aviso de entrada no grupo (acima) ou, se a Evolution
// estiver em https, de uma pergunta a ela, uma vez por dia (pega renomeação).
async function guardarNomeDoGrupo(instancia: string, grupoId: string) {
  try {
    const { data } = await banco.from("grupos").select("nome, atualizado_em").eq("id", grupoId).maybeSingle();
    const umDia = 24 * 60 * 60 * 1000;
    if (data?.nome && Date.now() - Date.parse(data.atualizado_em) < umDia) return;
    const nome = await buscarNomeNaEvolution(instancia, grupoId);
    if (nome) {
      await banco.from("grupos").upsert({ id: grupoId, nome, atualizado_em: new Date().toISOString() });
    } else if (!data) {
      await banco.from("grupos").upsert(
        { id: grupoId, nome: null, atualizado_em: new Date().toISOString() },
        { onConflict: "id", ignoreDuplicates: true },
      );
    }
  } catch (e) {
    // Nome é conforto: a mensagem já está gravada, e a próxima tenta de novo.
    console.error("não deu pra buscar o nome do grupo:", (e as Error).message);
  }
}

async function buscarNomeNaEvolution(instancia: string, grupoId: string): Promise<string | null> {
  const url = (Deno.env.get("EVOLUTION_URL") ?? "").replace(/\/+$/, "");
  const chave = Deno.env.get("EVOLUTION_API_KEY") ?? "";
  if (!url || !chave || !instancia) return null;
  // A chave da Evolution só viaja com criptografia (https). O http só vale
  // dentro do próprio computador, em teste.
  const seguro = url.startsWith("https://") || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url);
  if (!seguro) {
    console.warn("EVOLUTION_URL sem https: o nome do grupo não é buscado, pra chave não viajar aberta");
    return null;
  }
  const res = await fetch(
    `${url}/group/findGroupInfos/${encodeURIComponent(instancia)}?groupJid=${encodeURIComponent(grupoId)}`,
    { headers: { apikey: chave }, signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) return null;
  const nome = (await res.json())?.subject;
  return typeof nome === "string" && nome.trim() ? nome.trim() : null;
}

// Compara o segredo sem vazar, pelo tempo de resposta, quantas letras acertou.
// Espaço e quebra de linha nas pontas (comuns ao copiar e colar) não contam.
// Sem segredo configurado, recusa tudo. A recusa fica escrita nos Logs da
// função (sem o segredo), pra separar "segredo errado" de "JWT ligado".
async function segredoConfere(cabecalho: string | null): Promise<boolean> {
  const esperado = (Deno.env.get("WEBHOOK_SECRET") ?? "").trim();
  const recebido = (cabecalho ?? "").trim();
  if (!esperado) {
    console.warn("recusado: o WEBHOOK_SECRET não está cadastrado nos Secrets da função");
    return false;
  }
  const [a, b] = await Promise.all([resumo(esperado), resumo(recebido)]);
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a[i] ^ b[i];
  if (diferenca !== 0 || !recebido) {
    console.warn("recusado: o segredo do webhook não confere com o WEBHOOK_SECRET");
    return false;
  }
  return true;
}

async function resumo(texto: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
}

function resposta(status: number, corpo: Obj): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}
