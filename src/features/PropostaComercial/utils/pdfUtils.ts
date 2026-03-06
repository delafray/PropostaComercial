/**
 * Conta o número de páginas de um arquivo PDF sem depender de bibliotecas externas.
 * Lê o PDF como texto Latin-1 e busca o campo /Count no dicionário /Pages.
 * Funciona com PDFs gerados por CorelDRAW, Illustrator, InDesign e afins.
 */
export async function contarPaginasPdf(file: File): Promise<number> {
    const buffer = await file.arrayBuffer();
    const text = new TextDecoder('latin1').decode(new Uint8Array(buffer));

    // O PDF armazena a contagem total de páginas como /Count N na árvore /Pages.
    // Pega todos os valores de /Count e retorna o maior (que é o root).
    const matches = [...text.matchAll(/\/Count\s+(\d+)/g)];
    const counts = matches
        .map(m => parseInt(m[1]))
        .filter(n => n > 0 && n < 5000); // sanity check

    if (counts.length === 0) return 1;
    return Math.max(...counts);
}
