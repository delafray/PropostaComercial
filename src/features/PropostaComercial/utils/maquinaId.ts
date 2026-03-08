// !! REGRA N1: JAMAIS apague/mova arquivos fora de C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\ — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.
/**
 * Gera (ou recupera) um UUID persistente no localStorage
 * que serve como "fingerprint" do computador atual.
 * Usado para detectar quando uma proposta é aberta em uma máquina diferente.
 */
const KEY = 'pc_maquina_id';

export function getMaquinaId(): string {
    let id = localStorage.getItem(KEY);
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(KEY, id);
    }
    return id;
}
