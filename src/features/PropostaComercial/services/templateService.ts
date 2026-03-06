// @ts-nocheck
import { supabase } from '../../../../services/supabaseClient';
import { TemplateBackdrop, TemplateMascara, TemplateReferencia, PaginaConfig } from '../types';

const BUCKET = 'pc_arquivos';

export const templateService = {

    // --- STORAGE ---

    async uploadFile(file: File, folder: string): Promise<string> {
        const ext = file.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const filePath = `${folder}/${fileName}`;

        const { error } = await supabase.storage.from(BUCKET).upload(filePath, file);
        if (error) throw new Error(`Erro no upload: ${error.message}`);

        const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
        return data.publicUrl;
    },

    async deleteFileByUrl(publicUrl: string) {
        if (!publicUrl) return;
        const parts = publicUrl.split(`${BUCKET}/`);
        if (parts.length > 1) {
            await supabase.storage.from(BUCKET).remove([parts[1]]);
        }
    },

    // --- MÁSCARAS PDF (pc_templates_mascara) ---

    async getMascaras(): Promise<TemplateMascara[]> {
        const { data, error } = await supabase
            .from('pc_templates_mascara')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) throw new Error(error.message);
        return (data ?? []) as TemplateMascara[];
    },

    async createMascara(payload: Omit<TemplateMascara, 'id' | 'created_at'>): Promise<TemplateMascara> {
        const { data, error } = await supabase
            .from('pc_templates_mascara')
            .insert([payload])
            .select()
            .single();
        if (error) throw new Error(error.message);
        return data as TemplateMascara;
    },

    async deleteMascara(id: string, fileUrl: string) {
        // Desvincula fundos antes de deletar (evita FK constraint)
        await supabase.from('pc_templates_backdrop').update({ mascara_id: null }).eq('mascara_id', id);
        await this.deleteFileByUrl(fileUrl);
        const { error } = await supabase.from('pc_templates_mascara').delete().eq('id', id);
        if (error) throw new Error(error.message);
    },

    async updateMascaraPdf(id: string, oldUrl: string, newFile: File): Promise<string> {
        const url = await this.uploadFile(newFile, 'mascaras');
        await this.deleteFileByUrl(oldUrl);
        const { error } = await supabase
            .from('pc_templates_mascara')
            .update({ url_mascara_pdf: url, paginas_config: [] })
            .eq('id', id);
        if (error) throw new Error(error.message);
        return url;
    },

    async updateMascaraPaginas(id: string, paginas_config: PaginaConfig[]): Promise<void> {
        const { error } = await supabase
            .from('pc_templates_mascara')
            .update({ paginas_config })
            .eq('id', id);
        if (error) throw new Error(error.message);
    },

    // --- FUNDOS (pc_templates_backdrop) ---

    async getBackdrops(): Promise<TemplateBackdrop[]> {
        // Join com a máscara vinculada para exibir o nome no card
        const { data, error } = await supabase
            .from('pc_templates_backdrop')
            .select('*, mascara:pc_templates_mascara(id, nome)')
            .order('created_at', { ascending: false });
        if (error) throw new Error(error.message);
        return (data ?? []) as TemplateBackdrop[];
    },

    async createBackdrop(
        payload: Pick<TemplateBackdrop, 'nome' | 'url_imagem' | 'tipo_arquivo' | 'mascara_id'>
    ): Promise<TemplateBackdrop> {
        const { data, error } = await supabase
            .from('pc_templates_backdrop')
            .insert([payload])
            .select()
            .single();
        if (error) throw new Error(error.message);
        return data as TemplateBackdrop;
    },

    async deleteBackdrop(id: string, fileUrl: string) {
        await this.deleteFileByUrl(fileUrl);
        const { error } = await supabase.from('pc_templates_backdrop').delete().eq('id', id);
        if (error) throw new Error(error.message);
    },

    // --- ISCAS OPENCV (pc_templates_referencia) ---

    async getReferencias(): Promise<TemplateReferencia[]> {
        const { data, error } = await supabase
            .from('pc_templates_referencia')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) throw new Error(error.message);
        return (data ?? []) as TemplateReferencia[];
    },

    async createReferencia(
        payload: Omit<TemplateReferencia, 'id' | 'created_at'>
    ): Promise<TemplateReferencia> {
        const { data, error } = await supabase
            .from('pc_templates_referencia')
            .insert([payload])
            .select()
            .single();
        if (error) throw new Error(error.message);
        return data as TemplateReferencia;
    },

    async deleteReferencia(id: string, fileUrl: string) {
        await this.deleteFileByUrl(fileUrl);
        const { error } = await supabase.from('pc_templates_referencia').delete().eq('id', id);
        if (error) throw new Error(error.message);
    },
};
