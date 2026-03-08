// @ts-nocheck
import { supabase } from '../../../../services/supabaseClient';

/**
 * Serviço de preferências do usuário (pc_user_prefs).
 * Armazena pares chave-valor JSONB por usuário logado.
 */
export const prefService = {

    async savePref(chave: string, valor: object): Promise<void> {
        const { data } = await supabase.auth.getUser();
        const user = data?.user;
        if (!user) throw new Error('Usuário não autenticado');

        const { error } = await supabase
            .from('pc_user_prefs')
            .upsert(
                {
                    user_id: user.id,
                    chave,
                    valor,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: 'user_id,chave' }
            );
        if (error) throw new Error(error.message);
    },

    async loadPref(chave: string): Promise<object | null> {
        const { data: authData } = await supabase.auth.getUser();
        const user = authData?.user;
        if (!user) return null;

        const { data, error } = await supabase
            .from('pc_user_prefs')
            .select('valor')
            .eq('user_id', user.id)
            .eq('chave', chave)
            .maybeSingle();

        if (error) throw new Error(error.message);
        return data?.valor ?? null;
    },

    async deletePref(chave: string): Promise<void> {
        const { data: authData } = await supabase.auth.getUser();
        const user = authData?.user;
        if (!user) return;

        const { error } = await supabase
            .from('pc_user_prefs')
            .delete()
            .eq('user_id', user.id)
            .eq('chave', chave);

        if (error) throw new Error(error.message);
    },
};
