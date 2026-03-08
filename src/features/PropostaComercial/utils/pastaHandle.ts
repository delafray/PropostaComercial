// !! REGRA N1: JAMAIS apague/mova arquivos fora de C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\ — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.
/**
 * pastaHandle.ts
 * Persiste o FileSystemDirectoryHandle no IndexedDB local da máquina.
 * O handle permite que o browser re-acesse a mesma pasta nas próximas sessões,
 * precisando apenas que o usuário clique "Permitir" uma vez por sessão.
 */

const DB_NAME = 'pc_pasta_db';
const STORE   = 'handles';
const KEY     = 'ultima_pasta';

function abrirDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess       = () => resolve(req.result);
        req.onerror         = () => reject(req.error);
    });
}

/** Salva o handle no IndexedDB desta máquina. */
export async function salvarHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    const db = await abrirDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(handle, KEY);
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
    });
}

/** Recupera o handle salvo. Retorna null se não houver nenhum. */
export async function carregarHandle(): Promise<FileSystemDirectoryHandle | null> {
    const db = await abrirDb();
    return new Promise((resolve, reject) => {
        const tx  = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(KEY);
        req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
        req.onerror   = () => reject(req.error);
    });
}

/**
 * Solicita permissão de leitura ao browser.
 * Se já tiver permissão, retorna true silenciosamente.
 * Se o usuário negar, retorna false.
 * ATENÇÃO: deve ser chamado por um gesto do usuário (clique).
 */
export async function pedirPermissao(handle: FileSystemDirectoryHandle): Promise<boolean> {
    const perm = await (handle as any).queryPermission({ mode: 'read' });
    if (perm === 'granted') return true;
    const result = await (handle as any).requestPermission({ mode: 'read' });
    return result === 'granted';
}

/** Lê todos os arquivos da raiz do diretório (sem subpastas). */
export async function lerArquivos(handle: FileSystemDirectoryHandle): Promise<File[]> {
    const files: File[] = [];
    for await (const entry of (handle as any).values()) {
        if (entry.kind === 'file') {
            files.push(await entry.getFile());
        }
    }
    return files;
}

/** Verifica se o browser suporta a File System Access API. */
export function suportaFSA(): boolean {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}
