// !! REGRA N1: JAMAIS apague/mova arquivos fora de C:\Users\ronal\Documents\Antigravity\Proposta_Comercial\ — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.
export const seededShuffle = <T,>(array: T[], seed: number): T[] => {
    const newArray = [...array];
    let m = newArray.length, t, i;

    // Linear Congruential Generator (LCG) for simple, fast, seeded randomness
    // Microsoft Visual C++ constants
    let state = seed;
    const rand = () => {
        state = (state * 214013 + 2531011) & 0x7FFFFFFF;
        return state / 0x7FFFFFFF;
    };

    while (m) {
        i = Math.floor(rand() * m--);
        t = newArray[m];
        newArray[m] = newArray[i];
        newArray[i] = t;
    }

    return newArray;
};
