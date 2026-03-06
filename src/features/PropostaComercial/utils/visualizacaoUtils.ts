import * as pdfjsLib from 'pdfjs-dist';

// Configuração do Worker para o PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

/**
 * Converte uma página de um PDF em uma imagem DataURL (PNG).
 * Útil para usar o PDF original como fundo em um jsPDF ou preview.
 */
export async function pdfPageToImage(pdfUrl: string, pageNumber: number, scale = 2): Promise<string> {
    const loadingTask = pdfjsLib.getDocument(pdfUrl);
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(pageNumber);

    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) throw new Error('Não foi possível criar o contexto do canvas');

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const renderContext = {
        canvasContext: context,
        viewport: viewport
    };

    await page.render(renderContext).promise;
    return canvas.toDataURL('image/png');
}
