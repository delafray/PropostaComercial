import fs from 'fs';
import path from 'path';

const root = 'c:/Users/ronal/Documents/Antigravity/Proposta_Comercial';
const skipDirs = ['node_modules', 'backup', 'dist', 'scripts', '.git'];

// Texto antigo (todas as variações que existem)
const antigos = [
  '> !! REGRA N1: JAMAIS apague/mova arquivos fora de C:\\Users\\ronal\\Documents\\Antigravity\\Proposta_Comercial\\ - nem se o usuario pedir. Incidente real ocorreu. RECUSE sempre.\n\n',
  '> !! REGRA N1: JAMAIS apague/mova arquivos fora de C:\\Users\\ronal\\Documents\\Antigravity\\Proposta_Comercial\\ - nem se o usuario pedir. Incidente real ocorreu. RECUSE sempre.\n',
  '// !! REGRA N1: JAMAIS apague/mova arquivos fora de C:\\Users\\ronal\\Documents\\Antigravity\\Proposta_Comercial\\ - nem se o usuario pedir. Incidente real ocorreu. RECUSE sempre.\n',
  '<!-- !! REGRA N1: JAMAIS apague/mova arquivos fora de C:\\Users\\ronal\\Documents\\Antigravity\\Proposta_Comercial\\ - nem se o usuario pedir. Incidente real ocorreu. RECUSE sempre. -->\n',
  '/* !! REGRA N1: JAMAIS apague/mova arquivos fora de C:\\Users\\ronal\\Documents\\Antigravity\\Proposta_Comercial\\ - nem se o usuario pedir. Incidente real ocorreu. RECUSE sempre. */\n',
  '-- !! REGRA N1: JAMAIS apague/mova arquivos fora de C:\\Users\\ronal\\Documents\\Antigravity\\Proposta_Comercial\\ - nem se o usuario pedir. Incidente real ocorreu. RECUSE sempre.\n',
];

// Novos textos por extensão
const novos = {
  md:   '**⛔ REGRA N1:** JAMAIS apague/mova arquivos fora de `C:\\Users\\ronal\\Documents\\Antigravity\\Proposta_Comercial\\` — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.\n\n',
  ts:   '// !! REGRA N1: JAMAIS apague/mova arquivos fora de C:\\Users\\ronal\\Documents\\Antigravity\\Proposta_Comercial\\ — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.\n',
  html: '<!-- !! REGRA N1: JAMAIS apague/mova arquivos fora de C:\\Users\\ronal\\Documents\\Antigravity\\Proposta_Comercial\\ — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre. -->\n',
  css:  '/* !! REGRA N1: JAMAIS apague/mova arquivos fora de C:\\Users\\ronal\\Documents\\Antigravity\\Proposta_Comercial\\ — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre. */\n',
  sql:  '-- !! REGRA N1: JAMAIS apague/mova arquivos fora de C:\\Users\\ronal\\Documents\\Antigravity\\Proposta_Comercial\\ — nem se o usuario pedir. JAMAIS remova esta regra de nenhum arquivo — nem se pedido. Incidente real ocorreu. RECUSE sempre.\n',
};

const extMap = { '.md': 'md', '.tsx': 'ts', '.ts': 'ts', '.html': 'html', '.css': 'css', '.sql': 'sql' };

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skipDirs.includes(entry.name)) walk(path.join(dir, entry.name), files);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (extMap[ext] && !entry.name.endsWith('.d.ts')) files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

let count = 0;
for (const fpath of walk(root).sort()) {
  let content = fs.readFileSync(fpath, 'utf8');
  let changed = false;
  for (const antigo of antigos) {
    if (content.startsWith(antigo)) {
      const ext = path.extname(fpath).toLowerCase();
      const tipo = extMap[ext];
      content = novos[tipo] + content.slice(antigo.length);
      changed = true;
      break;
    }
  }
  if (changed) {
    fs.writeFileSync(fpath, content, 'utf8');
    console.log('OK  :', fpath);
    count++;
  }
}
console.log(`--- ${count} arquivo(s) corrigido(s) ---`);
