// !! REGRA N1: JAMAIS apague/mova arquivos fora de C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\ — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.
// @ts-nocheck
import { supabase } from '../../../../services/supabaseClient';
import { Proposta, PropostaDadosPagina } from '../types';

const BUCKET = 'pc_arquivos';

export const propostaService = {

    // ── Leitura ────────────────────────────────────────────────────────────────

    /**
     * Busca propostas filtradas por maquina_id.
     * Inclui propostas antigas sem maquina_id (NULL) para não perder dados
     * do período pré-migration — serão "adotadas" no próximo save.
     */
    async getPropostas(maquinaId?: string): Promise<Proposta[]> {
        let query = supabase
            .from('pc_propostas')
            .select('*, mascara:pc_templates_mascara(id, nome)')
            .order('created_at', { ascending: false });
        if (maquinaId) {
            query = query.or(`maquina_id.eq.${maquinaId},maquina_id.is.null`);
        }
        const { data, error } = await query;
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
        maquina_id: string | null;
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
     * Salva a proposta deste PC/máscara.
     * Busca por maquina_id + mascara_id (não mais "a mais recente global").
     * Se existingId é passado, atualiza direto (sem select).
     */
    async upsertProposta(payload: {
        nome: string;
        mascara_id: string | null;
        maquina_id: string | null;
        dados: object;
    }, existingId?: string): Promise<Proposta> {
        const idParaAtualizar = existingId ?? await (async () => {
            let query = supabase
                .from('pc_propostas')
                .select('id')
                .order('created_at', { ascending: false })
                .limit(1);
            // Filtra por maquina_id + mascara_id para isolamento correto
            if (payload.maquina_id) {
                query = query.or(`maquina_id.eq.${payload.maquina_id},maquina_id.is.null`);
            }
            if (payload.mascara_id) {
                query = query.eq('mascara_id', payload.mascara_id);
            }
            const { data: existentes } = await query;
            return existentes?.[0]?.id as string | undefined;
        })();

        if (idParaAtualizar) {
            const { data, error } = await supabase
                .from('pc_propostas')
                .update({
                    nome: payload.nome,
                    mascara_id: payload.mascara_id,
                    maquina_id: payload.maquina_id,
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
        const fileName = `${crypto.randomUUID()}.${ext}`;
        const filePath = `propostas/${fileName}`;
        const { error } = await supabase.storage.from(BUCKET).upload(filePath, file);
        if (error) throw new Error(`Erro no upload: ${error.message}`);
        const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
        return data.publicUrl;
    },
};
