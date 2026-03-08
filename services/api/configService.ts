// !! REGRA N1: JAMAIS apague/mova arquivos fora de C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\ — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.
import { supabase } from '../supabaseClient';

export const configService = {
    getSystemConfig: async (key: string): Promise<string | null> => {
        try {
            const { data, error } = await supabase
                .from('system_config')
                .select('value')
                .eq('key', key)
                .maybeSingle();

            if (error) throw error;
            return data?.value ?? null;
        } catch (err) {
            console.error('Error fetching system config:', err);
            return null;
        }
    },

    updateSystemConfig: async (_userId: string, key: string, value: string): Promise<void> => {
        const { error } = await supabase
            .from('system_config')
            .upsert({ key, value, updated_at: new Date().toISOString() });

        if (error) throw new Error(`Failed to update system config: ${error.message}`);
    }
};
