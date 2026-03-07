import { ProjetoInput } from '../types';

/**
 * Padrões de reconhecimento da pasta de projeto.
 * Classificação 100% por nome de arquivo — zero leitura de conteúdo.
 *
 * Estrutura esperada da pasta:
 *   10.jpg, 11.jpg ...  → renders (ordenados numericamente, menor = capa)
 *   9182.pdf            → briefing do projeto (4-5 dígitos)
 *   Planta.png/.svg     → planta baixa
 *   altura_3,50m.png    → tamanho do estande (número extraído do nome)
 *   logo.png            → logo do cliente
 *   *.txt               → memorial descritivo / diagramação
 */

const RE_RENDER    = /^\d+\.(jpg|jpeg|png)$/i;
const RE_BRIEFING  = /^\d{4,5}\.pdf$/i;
const RE_PLANTA    = /^planta\.(png|jpg|jpeg|svg)$/i;
const RE_LOGO      = /^logo\.(png|jpg|jpeg)$/i;
const RE_TAMANHO   = /(\d+)[,.](\d+)\s*m/i;  // ex: "3,50m" ou "3.50m"

/**
 * Extrai o tamanho do estande do nome do arquivo.
 * "altura_3,50m.png" → "3.50"
 */
function extrairTamanho(filename: string): string | null {
    const m = RE_TAMANHO.exec(filename);
    if (!m) return null;
    return `${m[1]}.${m[2]}`;
}

/**
 * Extrai o número de ordenação de um render.
 * "10.jpg" → 10, "09.jpg" → 9
 */
function numeroRender(filename: string): number {
    // Extrai apenas dígitos iniciais do nome (antes do primeiro ponto)
    const match = filename.match(/^(\d+)\./);
    const n = match ? parseInt(match[1], 10) : NaN;
    // NaN → Infinity: arquivos sem número numérico vão para o final da lista
    return isNaN(n) ? Infinity : n;
}

/**
 * Classifica os arquivos de uma pasta de projeto.
 * Recebe um FileList (do <input webkitdirectory>) e retorna o ProjetoInput tipado.
 * Operação instantânea — apenas regex sobre nomes, sem await, sem leitura.
 */
export function parsePasta(files: FileList | File[]): ProjetoInput {
    const lista = Array.from(files);

    const resultado: ProjetoInput = {
        renders: [],
        briefingPdf: null,
        planta: null,
        logo: null,
        memorial: null,
        tamanhoEstande: null,
        arquivoTamanho: null,
    };

    // PDFs que não batem com RE_BRIEFING ficam aqui como fallback
    const pdfsFallback: File[] = [];

    for (const file of lista) {
        // Usa apenas o nome base (sem subpastas)
        const nome = file.name;

        if (RE_RENDER.test(nome)) {
            resultado.renders.push(file);
        } else if (RE_BRIEFING.test(nome)) {
            resultado.briefingPdf = file;
        } else if (RE_PLANTA.test(nome)) {
            resultado.planta = file;
        } else if (RE_LOGO.test(nome)) {
            resultado.logo = file;
        } else if (nome.endsWith('.txt')) {
            resultado.memorial = file;
        } else if (RE_TAMANHO.test(nome)) {
            resultado.tamanhoEstande = extrairTamanho(nome);
            resultado.arquivoTamanho = file;
        } else if (nome.toLowerCase().endsWith('.pdf')) {
            pdfsFallback.push(file);
        }
    }

    // Fallback: se nenhum PDF com nome numérico foi encontrado, usa o primeiro PDF da pasta
    if (!resultado.briefingPdf && pdfsFallback.length > 0) {
        resultado.briefingPdf = pdfsFallback[0];
    }

    // Ordena renders numericamente: menor número = índice 0 (capa)
    resultado.renders.sort((a, b) => numeroRender(a.name) - numeroRender(b.name));

    return resultado;
}
