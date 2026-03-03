import React, { useState } from 'react';

// Preços fictícios para os itens (base para o cálculo)
const TABELA_PRECOS: Record<string, number> = {
    'STAND PADRÃO': 5000,
    'COMBO 01': 2000,
    'COMBO 02': 3000,
    'COMBO 03': 4000,
    'Blimp': 1000,
    'Galhardete': 500,
    'Logo back drop': 800,
    'Rádio feira': 600,
    'Logo pórtico': 1000,
    'Outdoor': 3000,
    'Blimp palco': 1500,
    'Locução': 800,
    'Palco': 5000,
};

const ITEMS = Object.keys(TABELA_PRECOS);

type CellStatus = '' | 'x' | '*';

interface RowData {
    id: string;
    standNr: string;
    cliente: string;
    items: Record<string, CellStatus>;
    desconto: number;
    valorPago: number;
}

const TempPlanilha: React.FC = () => {
    const [rows, setRows] = useState<RowData[]>([
        { id: '1', standNr: 'Naming 01', cliente: '', items: {}, desconto: 0, valorPago: 0 },
        { id: '2', standNr: 'Naming 02', cliente: 'Cliente A', items: { 'Logo back drop': '*' }, desconto: 0, valorPago: 0 },
        { id: '3', standNr: 'Naming 03', cliente: '', items: {}, desconto: 0, valorPago: 0 },
        { id: '4', standNr: 'Naming 04', cliente: 'Cliente B', items: { 'Logo pórtico': 'x' }, desconto: 0, valorPago: 0 },
        { id: '5', standNr: 'Naming 05', cliente: '', items: {}, desconto: 0, valorPago: 0 },
        { id: '6', standNr: 'Naming 06', cliente: '', items: {}, desconto: 0, valorPago: 0 },
        { id: '7', standNr: 'Naming 07', cliente: '', items: {}, desconto: 0, valorPago: 0 },
        { id: '8', standNr: 'Naming 08', cliente: '', items: {}, desconto: 0, valorPago: 0 },
    ]);

    const toggleCell = (rowId: string, item: string) => {
        setRows(prevRows => prevRows.map(row => {
            if (row.id === rowId) {
                const current = row.items[item] || '';
                let next: CellStatus = '';
                if (current === '') next = 'x';
                else if (current === 'x') next = '*';
                else next = '';

                return {
                    ...row,
                    items: {
                        ...row.items,
                        [item]: next
                    }
                };
            }
            return row;
        }));
    };

    const updateField = (rowId: string, field: keyof RowData, value: string | number) => {
        setRows(prevRows => prevRows.map(row => {
            if (row.id === rowId) {
                return { ...row, [field]: value };
            }
            return row;
        }));
    };

    const calculateRow = (row: RowData) => {
        let subTotal = 0;
        ITEMS.forEach(item => {
            if (row.items[item] === 'x') {
                subTotal += TABELA_PRECOS[item];
            }
            // '*' não soma valor
        });

        const total = subTotal - row.desconto;
        const pendente = total - row.valorPago;

        return { subTotal, total, pendente };
    };

    const formatMoney = (value: number) => {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    };

    // Calcular os totais globais (linha 1 e 2)
    const totaisGlobais = rows.reduce(
        (acc, row) => {
            const rowCalc = calculateRow(row);
            acc.subTotal += rowCalc.subTotal;
            acc.descontos += row.desconto || 0;
            acc.totalVendas += rowCalc.total;
            acc.valorPago += row.valorPago || 0;
            acc.pendente += rowCalc.pendente;

            ITEMS.forEach(item => {
                if (row.items[item] === 'x' || row.items[item] === '*') {
                    acc.quantidades[item] = (acc.quantidades[item] || 0) + 1;
                }
            });
            return acc;
        },
        { subTotal: 0, descontos: 0, totalVendas: 0, valorPago: 0, pendente: 0, quantidades: {} as Record<string, number> }
    );

    return (
        <div className="p-4 bg-gray-100 min-h-screen font-sans">
            <div className="mb-4">
                <h1 className="text-2xl font-bold text-gray-800">Protótipo da Planilha de Vendas</h1>
                <p className="text-gray-600 text-sm mt-1">
                    Clique nas células dos itens para alternar: <br />
                    <span className="inline-block w-4 h-4 bg-white border border-gray-300 ml-1 mr-1 align-middle"></span> Vazio <br />
                    <span className="inline-block w-4 h-4 bg-green-500 font-bold text-center text-xs text-white leading-4 ml-1 mr-1 align-middle">x</span> Cobrar (Soma no valor)<br />
                    <span className="inline-block w-4 h-4 bg-blue-500 font-bold text-center text-xs text-white leading-4 ml-1 mr-1 align-middle">*</span> Separar (Custo Zero)
                </p>
            </div>

            <div className="overflow-x-auto shadow rounded-lg border border-gray-300">
                <table className="w-full text-sm text-left bg-white border-collapse whitespace-nowrap">
                    <thead className="text-white">
                        {/* LINHA 1: Cabeçalhos Principais de Totais (Azul escuro até Sub Total, depois colorido) */}
                        <tr className="bg-[#1F497D] text-[10px] font-bold tracking-wider">
                            <th colSpan={ITEMS.length + 3} className="px-2 py-1 border border-blue-800"></th>
                            <th className="px-1 py-1 border border-yellow-600 bg-[#D99A29] text-center w-24">DESCONTOS</th>
                            <th className="px-1 py-1 border border-green-700 bg-[#000000] text-center w-28">TOTAL DE VENDAS</th>
                            <th className="px-1 py-1 border border-green-700 bg-[#2E5E2D] text-center w-28">TOTAL PAGO</th>
                            <th className="px-1 py-1 border border-orange-700 bg-[#A74112] text-center w-32">TOTAL PENDENTE</th>
                        </tr>

                        {/* LINHA 2: Valores dos Totais e Contagem de Itens */}
                        <tr className="bg-[#1F497D] font-bold text-xs text-center border-b-[3px] border-white">
                            <th colSpan={2} className="px-2 py-2 border border-blue-800 text-right text-[#FCE4D6]">
                                {/* Aqui poderíamos colocar uma legenda, ex: contagem total */}
                            </th>

                            {/* Contagem de Itens (A linha Bege que você mencionou) */}
                            {ITEMS.map(item => {
                                const count = totaisGlobais.quantidades[item] || 0;
                                return (
                                    <th key={`count-${item}`} className={`border text-black border-blue-800 px-0.5 py-1 text-[11px] ${count > 0 ? 'bg-[#FCE4D6]' : 'bg-[#FCE4D6]/50'}`}>
                                        {count}
                                    </th>
                                );
                            })}

                            <th className="px-2 py-2 border border-blue-800 bg-[#1F497D]"></th> {/* Coluna Sub Total na linha de totais fica vazia na imagem */}
                            <th className="px-1 py-2 border border-yellow-600 bg-[#D99A29] text-black">
                                {formatMoney(totaisGlobais.descontos)}
                            </th>
                            <th className="px-1 py-2 border border-green-700 bg-[#000000] text-white">
                                {formatMoney(totaisGlobais.totalVendas)}
                            </th>
                            <th className="px-1 py-2 border border-green-700 bg-[#2E5E2D] text-white">
                                {formatMoney(totaisGlobais.valorPago)}
                            </th>
                            <th className="px-1 py-2 border border-orange-700 bg-[#A74112] text-white leading-tight">
                                {formatMoney(totaisGlobais.pendente)}
                            </th>
                        </tr>

                        {/* LINHA 3: Títulos das Colunas Verticais */}
                        <tr className="bg-[#1F497D] text-xs">
                            <th className="px-1 py-4 border border-blue-800 font-semibold w-20">Stand nº</th>
                            <th className="px-2 py-4 border border-blue-800 font-semibold w-40">Cliente:</th>

                            {/* Cabeçalhos dos Itens Verticais (Mais finos) */}
                            {ITEMS.map(item => (
                                <th key={`header-${item}`} className="px-0 py-2 border border-blue-800 font-normal w-6 max-w-[24px] text-center align-bottom" title={item}>
                                    <div className="writing-mode-vertical mx-auto h-[100px] flex justify-center items-end" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                                        <span className="truncate w-full inline-block text-[10px] pb-1">{item}</span>
                                    </div>
                                </th>
                            ))}

                            <th className="px-1 py-4 border border-blue-800 font-semibold text-center w-24">Sub Total</th>
                            <th className="px-1 py-1 border border-blue-800 font-normal bg-[#3b669e] text-center w-24 text-[9px] leading-tight flex-col justify-center">
                                Outros desconto / acrescimo incluir comentario
                            </th>
                            <th className="px-1 py-4 border border-blue-800 font-semibold text-center w-28 bg-[#1F497D]">Total</th>
                            <th className="px-1 py-4 border border-blue-800 font-semibold text-center w-28 bg-[#1F497D]">Valor pago</th>
                            <th className="px-1 py-4 border border-blue-800 font-semibold text-center w-32 bg-[#1F497D]">Valor pendente</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, index) => {
                            const calc = calculateRow(row);
                            const bgClass = index < 8 ? 'bg-[#FCE4D6]' : 'bg-[#FFF2CC]'; // Cores inspiradas na planilha

                            return (
                                <tr key={row.id} className="border-b border-gray-400 hover:bg-gray-50 hover:[&>td]:bg-gray-50 transition-colors">
                                    <td className={`px-1 py-0.5 border border-gray-400 font-medium ${bgClass} text-xs w-20`}>{row.standNr}</td>
                                    <td className={`px-1 py-0 border border-gray-400 ${bgClass} w-40 max-w-[160px]`}>
                                        <input
                                            type="text"
                                            className="w-full bg-transparent outline-none p-0.5 text-xs h-full"
                                            value={row.cliente}
                                            onChange={e => updateField(row.id, 'cliente', e.target.value)}
                                        />
                                    </td>

                                    {/* Células de Itens MAIS FINAS */}
                                    {ITEMS.map(item => {
                                        const status = row.items[item] || '';
                                        let cellClass = "cursor-pointer text-center font-bold select-none transition-colors border-gray-400 ";
                                        if (status === 'x') cellClass += 'bg-[#66FF33] text-black'; // Verde claro igual excel
                                        else if (status === '*') cellClass += 'bg-[#00B0F0] text-black'; // Azul claro igual excel
                                        else cellClass += 'hover:bg-gray-200 bg-white';

                                        return (
                                            <td
                                                key={`${row.id}-${item}`}
                                                className={`border h-5 w-5 min-w-[20px] max-w-[24px] text-[10px] leading-tight p-0 ${cellClass}`}
                                                onClick={() => toggleCell(row.id, item)}
                                                title={item}
                                            >
                                                {status}
                                            </td>
                                        );
                                    })}

                                    <td className="px-1 py-1 border border-gray-400 text-right text-gray-700 bg-gray-50 w-24 text-xs font-medium">
                                        {calc.subTotal > 0 ? formatMoney(calc.subTotal) : 'R$ -'}
                                    </td>
                                    <td className="px-1 py-0 border border-gray-400 text-right bg-white w-24">
                                        <input
                                            type="number"
                                            className="w-full text-right bg-transparent outline-none p-0.5 text-xs text-black"
                                            value={row.desconto === 0 ? '' : row.desconto} // Vazio se 0
                                            onChange={e => updateField(row.id, 'desconto', Number(e.target.value))}
                                        />
                                    </td>
                                    <td className={`px-1 py-1 border border-gray-400 text-right w-28 text-xs ${calc.total > 0 ? 'bg-[#E2EFF6] text-black font-medium' : 'bg-gray-50 text-gray-500'}`}>
                                        {calc.total > 0 ? formatMoney(calc.total) : 'R$ -'}
                                    </td>
                                    <td className="px-1 py-0 border border-gray-400 text-right bg-[#E8F1FC] w-28 text-xs">
                                        <input
                                            type="number"
                                            className="w-full text-right bg-transparent outline-none p-0.5 text-black"
                                            value={row.valorPago === 0 ? '' : row.valorPago}
                                            onChange={e => updateField(row.id, 'valorPago', Number(e.target.value))}
                                        />
                                    </td>
                                    <td className={`px-1 py-1 border border-gray-400 text-right w-32 text-xs ${calc.pendente > 0 ? 'bg-[#FBE4D5] text-black font-medium' : 'bg-gray-50 text-gray-400'}`}>
                                        {calc.pendente > 0 ? formatMoney(calc.pendente) : 'R$ -'}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="mt-8 text-sm text-gray-500">
                <p><strong>Nota técnica:</strong> Esta é apenas uma interface visual local. Os dados serão perdidos ao recarregar a página (F5), pois não estão conectados ao banco de dados real. Feito apenas para validação de experiência do usuário.</p>
            </div>
        </div>
    );
};

export default TempPlanilha;
