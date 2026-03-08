// !! REGRA N1: JAMAIS apague/mova arquivos fora de C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\ — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.
import { useState } from 'react';
import { jsPDF } from 'jspdf';
import { Tag } from '../../types';
import { api } from '../../services/api';
import { loadImage } from '../utils/imageUtils';
import { AlertType } from '../../components/AlertModal';

interface UsePdfExportProps {
    filteredResult: { ids: string[] };
    selectedExportIds: Set<string>;
    setSelectedExportIds: (ids: Set<string>) => void;
    pdfLimit: number;
    tags: Tag[];
    showAlert: (title: string, message: string, type?: AlertType) => void;
    onPdfReady: (blob: Blob, fileName: string) => void;
}

export const usePdfExport = ({
    filteredResult,
    selectedExportIds,
    setSelectedExportIds,
    pdfLimit,
    tags,
    showAlert,
    onPdfReady
}: UsePdfExportProps) => {
    const [exportProgress, setExportProgress] = useState<string>('');
    const [isExporting, setIsExporting] = useState(false);

    const handleExportPDF = async () => {
        // Determine which IDs to export:
        // Strictly INTERSECTION of Selection AND Current Filter (Redundancy of bottom popup)
        const idsToExport = filteredResult.ids.filter(id => selectedExportIds.has(id));

        const photosToExportCount = idsToExport.length;

        if (photosToExportCount === 0) {
            showAlert('Atenção', 'Nenhuma foto selecionada ou visível para exportação.', 'warning');
            return;
        }

        if (photosToExportCount > pdfLimit) {
            showAlert(
                'Limite de Exportação',
                `Limite de exportação excedido. Selecione no máximo ${pdfLimit} fotos para gerar o PDF. (Atual: ${photosToExportCount})`,
                'warning'
            );
            return;
        }

        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 6; // Further reduced to maximize width

        setIsExporting(true);

        try {
            // 1. Pre-load Masks and Photo Data in parallel
            const [maskTopo, maskBase, allPhotosToExport] = await Promise.all([
                loadImage('/assets/mascara_topo.jpg'),
                loadImage('/assets/mascara_base.jpg'),
                api.getPhotosByIds(idsToExport)
            ]);

            const totalPhotos = allPhotosToExport.length;
            const loadedImages: Record<string, HTMLImageElement> = {};

            // 2. Parallel Image Loading with Concurrency Limit (e.g., 5)
            const concurrencyLimit = 5;
            for (let i = 0; i < allPhotosToExport.length; i += concurrencyLimit) {
                const batch = allPhotosToExport.slice(i, i + concurrencyLimit);
                await Promise.all(batch.map(async (photo) => {
                    try {
                        loadedImages[photo.id] = await loadImage(photo.url);
                    } catch (e) {
                        console.error(`Error pre-loading ${photo.id}`, e);
                    }
                    // Update progress (5% to 85%)
                    setExportProgress(5 + Math.round(((i + batch.length) / totalPhotos) * 80));
                }));
            }

            const addMasks = () => {
                try {
                    const topoHeight = (maskTopo.height * pageWidth) / maskTopo.width;
                    doc.addImage(maskTopo, 'JPEG', 0, 0, pageWidth, topoHeight);
                    const baseHeight = (maskBase.height * pageWidth) / maskBase.width;
                    doc.addImage(maskBase, 'JPEG', 0, pageHeight - baseHeight, pageWidth, baseHeight);
                    return { topoHeight, baseHeight };
                } catch (e) {
                    return { topoHeight: 0, baseHeight: 0 };
                }
            };

            let masks = addMasks();
            const photosPerPage = 2;
            const marginY = 4;

            // 3. Instant PDF Compilation (Images are already in memory)
            for (let i = 0; i < allPhotosToExport.length; i++) {
                const photo = allPhotosToExport[i];
                const img = loadedImages[photo.id];

                if (i > 0 && i % photosPerPage === 0) {
                    doc.addPage();
                    masks = addMasks();
                }

                const relativeIdx = i % photosPerPage;
                const availableHeight = pageHeight - masks.topoHeight - masks.baseHeight - (marginY * 3);
                const slotHeight = availableHeight / photosPerPage;
                const slotY = masks.topoHeight + marginY + (relativeIdx * (slotHeight + marginY));

                doc.setFont("helvetica", "bold");
                doc.setFontSize(10);
                doc.setTextColor(30, 41, 59); // Slate-800
                doc.text(photo.name, margin, slotY + 2); // Title at top of slot

                // Meta Info (Tags and Author) for PDF
                doc.setFont("helvetica", "normal");
                doc.setFontSize(7);
                doc.setTextColor(100, 116, 139); // Slate-500
                const tagNames = photo.tagIds.map(id => tags.find(t => t.id === id)?.name).filter(Boolean).join(' • ');
                const authorText = photo.userName ? ` | Cadastrado por: ${photo.userName}` : '';
                doc.text(`${tagNames}${authorText}`, margin, slotY + 6);

                if (img) {
                    const imageAreaY = slotY + 9; // Shifted from 5 to 9 to give space for meta info
                    const imageAreaHeight = slotHeight - 11; // Adjusted from 7 to 11 to fit within slot
                    const imageAreaWidth = pageWidth - (margin * 2);

                    let drawWidth = imageAreaWidth;
                    let drawHeight = (img.height * imageAreaWidth) / img.width;

                    if (drawHeight > imageAreaHeight) {
                        drawHeight = imageAreaHeight;
                        drawWidth = (img.width * imageAreaHeight) / img.height;
                    }

                    const xOffset = margin + (imageAreaWidth - drawWidth) / 2;
                    const yOffset = imageAreaY;
                    doc.addImage(img, 'JPEG', xOffset, yOffset, drawWidth, drawHeight);
                } else {
                    doc.setTextColor(200, 0, 0);
                    doc.text("[Erro ao carregar imagem]", margin, slotY + 15);
                }

                doc.setFont("helvetica", "normal");
                doc.setFontSize(8);
                doc.setTextColor(150);
                const pageNum = doc.internal.pages.length - 1;
                doc.text(`Página ${pageNum}`, pageWidth / 2, pageHeight - (masks.baseHeight / 2), { align: 'center' });

                // Final rapid progress update
                setExportProgress(85 + Math.round(((i + 1) / totalPhotos) * 15));
            }

            const fileName = `galeria_${new Date().getTime()}.pdf`;
            const pdfBlob = doc.output('blob');

            setExportProgress('Pronto!');
            // Delegate share/download/preview to the caller
            onPdfReady(pdfBlob, fileName);

            setTimeout(() => {
                setSelectedExportIds(new Set());
                setExportProgress('');
            }, 500);
        } catch (err) {
            console.error('Erro ao gerar PDF:', err);
            showAlert('Erro Operacional', 'Erro ao gerar PDF. Verifique se as imagens das máscaras e das fotos estão acessíveis.', 'error');
        } finally {
            setIsExporting(false);
        }
    };

    return {
        exportProgress,
        isExporting,
        handleExportPDF
    };
};
