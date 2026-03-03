import { supabase } from '../supabaseClient';
import type { TablesInsert, TablesUpdate } from '../../database.types';
import type { Photo } from '../../types';

// ─── Storage helpers ──────────────────────────────────────────────────────────

/**
 * Extrai o path relativo dentro do bucket 'photos' a partir de uma URL pública.
 * Ex: "https://xxx.supabase.co/storage/v1/object/public/photos/uid/file.jpg"
 *     → "uid/file.jpg"
 * Retorna null se a URL não for de Storage (ex.: data: URL ou URL externa).
 */
const extractStoragePath = (url: string | null | undefined): string | null => {
    if (!url || url.startsWith('data:')) return null;
    const match = url.match(/\/storage\/v1\/object\/public\/photos\/(.+)$/);
    return match ? decodeURIComponent(match[1]) : null;
};

/**
 * Remove arquivos do bucket 'photos'. Erros são logados mas não lançados,
 * para não bloquear a operação principal (ex.: deleção do registro do banco).
 * Exportado para uso no Photos.tsx ao substituir arquivos em edição.
 */
export const deletePhotoStorageFiles = async (urls: (string | null | undefined)[]): Promise<void> => {
    const paths = urls.map(extractStoragePath).filter((p): p is string => p !== null);
    // Remove duplicatas (ex.: url === thumbnailUrl em modo vídeo)
    const unique = [...new Set(paths)];
    if (unique.length === 0) return;

    const { error } = await supabase.storage.from('photos').remove(unique);
    if (error) console.error('[Storage] Falha ao remover arquivos:', unique, error);
};

// Inline types for Supabase join results
// Supabase can return joined relations as an object or a single-item array depending on schema/version
type PhotoTagRow = { tag_id: string };
type UserInnerRow = { name: string };
type UserRow = UserInnerRow | UserInnerRow[] | null;

type PhotoIndexRow = {
    id: string;
    name: string;
    user_id: string | null;
    created_at: string;
    video_url: string | null;
    url: string;
    thumbnail_url: string | null;
    local_path: string | null;
    storage_location: string | null;
    users: UserRow;
    photo_tags: PhotoTagRow[];
};

/**
 * Helper to extract user name safely from Supabase join results
 */
const extractUserName = (users: UserRow): string | undefined => {
    if (!users) return undefined;
    if (Array.isArray(users)) {
        return users[0]?.name;
    }
    return users.name;
};

export const photoService = {
    getPhotoIndex: async (userId: string, onlyMine?: boolean) => {
        let query = supabase
            .from('photos')
            .select('id,name,user_id,created_at,video_url,url,thumbnail_url,local_path,storage_location,users(name),photo_tags(tag_id)');

        if (onlyMine) {
            query = query.eq('user_id', userId);
        }

        query = query.order('created_at', { ascending: false });

        const { data, error } = await query;
        if (error) throw new Error(`Failed to fetch index: ${error.message}`);

        return ((data as unknown as PhotoIndexRow[]) || []).map(row => ({
            id: row.id,
            name: row.name,
            userId: row.user_id || '',
            userName: extractUserName(row.users),
            tagIds: (row.photo_tags || []).map(pt => pt.tag_id),
            videoUrl: row.video_url || undefined,
            url: row.url,
            thumbnailUrl: row.thumbnail_url || undefined,
            localPath: row.local_path || undefined,
            storageLocation: row.storage_location || undefined,
            createdAt: row.created_at
        }));
    },

    getPhotosByIds: async (ids: string[]) => {
        if (ids.length === 0) return [];

        const { data, error } = await supabase
            .from('photos')
            .select('*,users(name),photo_tags(tag_id)')
            .in('id', ids);

        if (error) throw new Error(`Failed to fetch photos by IDs: ${error.message}`);

        const photoMap = new Map<string, Photo>(((data as unknown as PhotoIndexRow[]) || []).map(row => [row.id, {
            id: row.id,
            userId: row.user_id || '',
            name: row.name,
            userName: extractUserName(row.users),
            url: row.url,
            thumbnailUrl: row.thumbnail_url || undefined,
            localPath: row.local_path || undefined,
            storageLocation: row.storage_location || undefined,
            videoUrl: row.video_url || undefined,
            tagIds: (row.photo_tags || []).map(pt => pt.tag_id),
            createdAt: row.created_at
        }]));

        return ids.map(id => photoMap.get(id)).filter((p): p is Photo => !!p);
    },

    getPhotos: async (userId: string) => {
        const { data, error } = await supabase
            .from('photos')
            .select('*,users(name),photo_tags(tag_id)')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw new Error(`Failed to fetch photos: ${error.message}`);

        return ((data as unknown as PhotoIndexRow[]) || []).map(row => ({
            id: row.id,
            userId: row.user_id || '',
            name: row.name,
            userName: extractUserName(row.users),
            url: row.url,
            thumbnailUrl: row.thumbnail_url || undefined,
            localPath: row.local_path || undefined,
            storageLocation: row.storage_location || undefined,
            videoUrl: row.video_url || undefined,
            tagIds: (row.photo_tags || []).map(pt => pt.tag_id),
            createdAt: row.created_at
        }));
    },

    uploadPhotoFile: async (userId: string, file: File) => {
        const fileExt = file.name.split('.').pop();
        const randomSuffix = Math.random().toString(36).substring(2, 7);
        const filePath = `${userId}/${Date.now()}_${randomSuffix}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
            .from('photos')
            .upload(filePath, file);

        if (uploadError) throw new Error(`Failed to upload photo: ${uploadError.message}`);

        const { data: { publicUrl } } = supabase.storage
            .from('photos')
            .getPublicUrl(filePath);

        return publicUrl;
    },

    createPhoto: async (userId: string, data: Omit<Photo, 'id' | 'createdAt' | 'userId'>) => {
        const insertData: TablesInsert<'photos'> = {
            user_id: userId,
            name: data.name,
            url: data.url,
            thumbnail_url: data.thumbnailUrl || null,
            local_path: data.localPath || null,
            storage_location: data.storageLocation || null,
            video_url: data.videoUrl || null
        };

        const { data: newPhoto, error: photoError } = await supabase
            .from('photos')
            .insert(insertData)
            .select()
            .single();

        if (photoError) throw new Error(`Failed to create photo: ${photoError.message}`);

        const tagIds = data.tagIds || [];
        if (tagIds.length > 0) {
            const photoTagsData = tagIds.map(tagId => ({
                photo_id: newPhoto.id,
                tag_id: tagId
            }));

            const { error: tagsError } = await supabase
                .from('photo_tags')
                .insert(photoTagsData);

            if (tagsError) throw new Error(`Failed to create photo tags: ${tagsError.message}`);
        }

        return {
            id: newPhoto.id,
            userId: newPhoto.user_id || '',
            name: newPhoto.name,
            url: newPhoto.url,
            thumbnailUrl: newPhoto.thumbnail_url || undefined,
            localPath: newPhoto.local_path || undefined,
            storageLocation: newPhoto.storage_location || undefined,
            videoUrl: newPhoto.video_url || undefined,
            tagIds: tagIds,
            createdAt: newPhoto.created_at
        };
    },

    updatePhoto: async (id: string, data: Partial<Photo>) => {
        const updateData: TablesUpdate<'photos'> = {};
        if (data.name !== undefined) updateData.name = data.name;
        if (data.url !== undefined) updateData.url = data.url;
        if (data.thumbnailUrl !== undefined) updateData.thumbnail_url = data.thumbnailUrl;
        if (data.localPath !== undefined) updateData.local_path = data.localPath;
        if (data.storageLocation !== undefined) updateData.storage_location = data.storageLocation;
        if (data.userId !== undefined) updateData.user_id = data.userId;
        if (data.videoUrl !== undefined) updateData.video_url = data.videoUrl;

        const { data: updatedPhoto, error: photoError } = await supabase
            .from('photos')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (photoError) throw new Error(`Failed to update photo: ${photoError.message}`);

        const finalTagIds = data.tagIds ?? [];

        if (data.tagIds !== undefined) {
            await supabase.from('photo_tags').delete().eq('photo_id', id);

            if (finalTagIds.length > 0) {
                const photoTagsData = finalTagIds.map(tagId => ({ photo_id: id, tag_id: tagId }));
                const { error: tagsError } = await supabase.from('photo_tags').insert(photoTagsData);
                if (tagsError) throw new Error(`Failed to update photo tags: ${tagsError.message}`);
            }
        }

        // Build return object from data already in memory – no extra SELECT needed
        return {
            id: updatedPhoto.id,
            userId: updatedPhoto.user_id || '',
            name: updatedPhoto.name,
            url: updatedPhoto.url,
            thumbnailUrl: updatedPhoto.thumbnail_url || undefined,
            localPath: updatedPhoto.local_path || undefined,
            storageLocation: updatedPhoto.storage_location || undefined,
            videoUrl: updatedPhoto.video_url || undefined,
            tagIds: finalTagIds,
            createdAt: updatedPhoto.created_at
        };
    },

    deletePhoto: async (id: string) => {
        // 1. Busca as URLs do arquivo antes de deletar o registro
        //    (após delete, não é mais possível saber quais arquivos remover)
        const { data: photoData } = await supabase
            .from('photos')
            .select('url, thumbnail_url')
            .eq('id', id)
            .single();

        // 2. Deleta o registro do banco
        const { error } = await supabase
            .from('photos')
            .delete()
            .eq('id', id);

        if (error) throw new Error(`Failed to delete photo: ${error.message}`);

        // 3. Remove os arquivos físicos do Storage (após confirmar o delete no banco)
        if (photoData) {
            await deletePhotoStorageFiles([photoData.url, photoData.thumbnail_url]);
        }
    }
};
