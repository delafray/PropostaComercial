// !! REGRA N1: JAMAIS apague/mova arquivos fora de C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\ — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.
import { jsPDF } from 'jspdf';
import { Photo, Tag, TagCategory } from '../../types';
import { api } from '../../services/api';

export const MAX_DIMENSION = 1280;
export const THUMB_SIZE = 300;
export const QUALITY = 0.8;

export const dataURLtoBlob = (dataurl: string) => {
    const arr = dataurl.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : '';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
};

export const generateThumbnail = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target?.result as string;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                if (width > height) {
                    if (width > THUMB_SIZE) { height *= THUMB_SIZE / width; width = THUMB_SIZE; }
                } else {
                    if (height > THUMB_SIZE) { width *= THUMB_SIZE / height; height = THUMB_SIZE; }
                }
                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) return reject('Canvas error');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.7));
            };
            img.onerror = reject;
        };
        reader.onerror = reject;
    });
};

export const extractInstagramShortcode = (url: string): string | null => {
    const match = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
};

export const extractYouTubeId = (url: string): string | null => {
    const match = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|shorts\/|watch\?v=)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return match ? match[1] : null;
};

export const fetchInstagramThumbnail = async (instagramUrl: string): Promise<string | null> => {
    const shortcode = extractInstagramShortcode(instagramUrl);
    if (!shortcode) return null;

    try {
        const resp = await fetch(
            'https://zamknopwowugrjapoman.supabase.co/functions/v1/instagram-thumbnail',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: instagramUrl }),
            }
        );
        if (!resp.ok) return null;
        const data = await resp.json();
        return data.thumbnailUrl || null;
    } catch {
        return null;
    }
};

export const isValidYouTubeThumb = (url: string): Promise<boolean> => {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            // YouTube returns a 120x90 placeholder if the requested resolution doesn't exist
            resolve(img.width > 120);
        };
        img.onerror = () => resolve(false);
        img.src = url;
    });
};

export const fetchYouTubeThumbnail = async (youtubeUrl: string): Promise<string | null> => {
    const videoId = extractYouTubeId(youtubeUrl);
    if (!videoId) return null;

    const maxResUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
    const hqResUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

    // Try maxres first, then fallback to hq
    const isMaxResValid = await isValidYouTubeThumb(maxResUrl);
    if (isMaxResValid) return maxResUrl;

    return hqResUrl; // hqdefault is almost always available
};

export const compressExternalImage = (imageUrl: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let { width, height } = img;
            // Resize to max MAX_DIMENSION
            if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                if (width > height) { height = Math.round(height * MAX_DIMENSION / width); width = MAX_DIMENSION; }
                else { width = Math.round(width * MAX_DIMENSION / height); height = MAX_DIMENSION; }
            }
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject('Canvas error');
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', QUALITY));
        };
        img.onerror = reject;
        img.src = imageUrl;
    });
};

export const processAndCompressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target?.result as string;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                if (width > height) {
                    if (width > MAX_DIMENSION) { height *= MAX_DIMENSION / width; width = MAX_DIMENSION; }
                } else {
                    if (height > MAX_DIMENSION) { width *= MAX_DIMENSION / height; height = MAX_DIMENSION; }
                }
                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) return reject('Canvas error');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', QUALITY));
            };
            img.onerror = reject;
        };
        reader.onerror = reject;
    });
};

export const loadImage = (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = src;
        img.onload = () => resolve(img);
        img.onerror = reject;
    });
};
