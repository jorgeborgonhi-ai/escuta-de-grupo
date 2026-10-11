// Copia banco.sql, receber-mensagem.ts e instrucoes-da-ia.md pra dentro do
// GUIA.md (Referências A, B e C), porque quem cola o guia numa IA de chat não
// tem como abrir os outros arquivos, e põe o GUIA.md inteiro dentro da página
// (index.html), pro botão de copiar. Os arquivos são a fonte; o resto é cópia.
//
//   node ferramentas/montar-guia.mjs             atualiza o GUIA.md
//   node ferramentas/montar-guia.mjs --conferir  só confere (sai com erro se estiver desatualizado)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pasta = join(dirname(fileURLToPath(import.meta.url)), "..", "escuta-de-grupo");
const caminhoGuia = join(pasta, "GUIA.md");
const linguagem = { sql: "sql", ts: "ts", md: "markdown" };

const guia = readFileSync(caminhoGuia, "utf8");
const montado = guia.replace(
  /<!-- arquivo: ([\w.-]+) -->\n[\s\S]*?<!-- fim -->/g,
  (_, nome) => {
    const conteudo = readFileSync(join(pasta, nome), "utf8").trimEnd();
    const cerca = "````";
    const lang = linguagem[nome.split(".").pop()] ?? "";
    return `<!-- arquivo: ${nome} -->\n${cerca}${lang}\n${conteudo}\n${cerca}\n<!-- fim -->`;
  },
);

// A página (index.html) leva o guia inteiro escondido, pro botão de copiar.
const caminhoPagina = join(pasta, "..", "index.html");
const pagina = readFileSync(caminhoPagina, "utf8");
const escapar = (t) => t.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const paginaMontada = pagina.replace(
  /(<!-- guia -->\n<textarea[^>]*>)[\s\S]*?(<\/textarea>\n<!-- fim do guia -->)/,
  (_, abre, fecha) => abre + escapar(montado) + fecha,
);

if (process.argv.includes("--conferir")) {
  if (montado !== guia || paginaMontada !== pagina) {
    console.error("GUIA.md desatualizado: rode node ferramentas/montar-guia.mjs");
    process.exit(1);
  }
  // Antes de publicar, o endereço do repositório tem que estar escrito no guia.
  if (guia.includes("REPO_URL") || pagina.includes("REPO_URL")) {
    console.error("GUIA.md ainda tem REPO_URL: troque pelo endereço do repositório");
    process.exit(1);
  }
  console.log("GUIA.md em dia com os arquivos");
} else {
  writeFileSync(caminhoGuia, montado);
  writeFileSync(caminhoPagina, paginaMontada);
  console.log("GUIA.md e index.html montados");
}
