// @ts-nocheck
import { supabase } from '../../../../services/supabaseClient';
import { Proposta, PropostaDadosPagina } from '../types';

const BUCKET = 'pc_arquivos';

export const propostaService = {

    // ── Leitura ────────────────────────────────────────────────────────────────

    async getPropostas(): Promise<Proposta[]> {
        const { data, error } = await supabase
            .from('pc_propostas')
            .select('*, mascara:pc_templates_mascara(id, nome)')
            .order('created_at', { ascending: false });
        if (error) throw new Error(error.message);
        return (data ?? []) as Proposta[];
    },

    async getPropostaById(id: string): Promise<Proposta> {
        const { data, error } = await supabase
            .from('pc_propostas')
            .select('*, mascara:pc_templates_mascara(id, nome)')
            .eq('id', id)
            .single();
        if (error) throw new Error(error.message);
        return data as Proposta;
    },

    // ── Escrita ────────────────────────────────────────────────────────────────

    async createProposta(payload: {
        nome: string;
        mascara_id: string | null;
        dados: object;
    }): Promise<Proposta> {
        const { data, error } = await supabase
            .from('pc_propostas')
            .insert([{ ...payload, status: 'rascunho' }])
            .select()
            .single();
        if (error) throw new Error(error.message);
        return data as Proposta;
    },

    /**
     * Salva a proposta única do sistema.
     * Passe `existingId` sempre que o ID já for conhecido (evita race condition
     * de leitura duplicada). Se `existingId` não for fornecido, busca a mais recente.
     */
    async upsertProposta(payload: {
        nome: string;
        mascara_id: string | null;
        dados: object;
    }, existingId?: string): Promise<Proposta> {
        // Se o ID já é conhecido, atualiza diretamente sem precisar fazer select
        const idParaAtualizar = existingId ?? await (async () => {
            const { data: existentes } = await supabase
                .from('pc_propostas')
                .select('id')
                .order('created_at', { ascending: false })
                .limit(1);
            return existentes?.[0]?.id as string | undefined;
        })();

        if (idParaAtualizar) {
            const { data, error } = await supabase
                .from('pc_propostas')
                .update({
                    nome: payload.nome,
                    mascara_id: payload.mascara_id,
                    dados: payload.dados,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', idParaAtualizar)
                .select()
                .single();
            if (error) throw new Error(error.message);
            return data as Proposta;
        } else {
            return this.createProposta(payload);
        }
    },

    async updateProposta(id: string, payload: {
        nome?: string;
        dados?: object;
        status?: 'rascunho' | 'finalizada';
    }): Promise<void> {
        const { error } = await supabase
            .from('pc_propostas')
            .update({ ...payload, updated_at: new Date().toISOString() })
            .eq('id', id);
        if (error) throw new Error(error.message);
    },

    async deleteProposta(id: string): Promise<void> {
        const { error } = await supabase.from('pc_propostas').delete().eq('id', id);
        if (error) throw new Error(error.message);
    },

    // ── Upload de imagens ──────────────────────────────────────────────────────

    async uploadImagemSlot(file: File): Promise<string> {
        const ext = file.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const filePath = `propostas/${fileName}`;
        const { error } = await supabase.storage.from(BUCKET).upload(filePath, file);
        if (error) throw new Error(`Erro no upload: ${error.message}`);
        const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
        return data.publicUrl;
    },
};
