# 📘 Manual de Prompts (Para Humanos)

> **O que é esta pasta?** Nas vezes em que eu (a IA) resolver um problema difícil ou construir um sistema complexo no seu aplicativo, nós criaremos um "Prompt Mestre" e o salvaremos aqui. 
> 
> A utilidade disso é gigantesca: **Se daqui a 2 anos você quiser criar um aplicativo do zero e precisar recriar a biometria ou a proteção de senhas, basta copiar o texto desses arquivos na ordem e mandar para a nova IA.** Ela fará em 5 minutos o que nós demoramos horas estudando para acertar.

Abaixo, explico de forma simples e livre de "tecnês" o que cada prompt guardado nesta pasta faz. Eles estão **ordenados por prioridade arquitetural** (do essencial para a fundação do aplicativo, até as funcionalidades extras de perfumaria).

---

## 01. 🧬 `PROMPT_01_BIOMETRIA_SUPABASE.md`
**(Autenticação e Segurança Dificílima)**
**O que ele faz:** Ensina uma IA a construir o sistema de "Entrar com Digital ou FaceID" (WebAuthn/Passkeys).
**Por que é genial:** No mundo real, a Apple e o Google (Android) têm várias "pegadinhas" de segurança quando o usuário tenta logar com a digital sem digitar o email antes. Esse prompt contém os macetes exatos de como lemos a digital do usuário, convertemos códigos bizarros em texto normal (Base64) e buscamos a identidade dele no banco de dados automaticamente.

---

## 02. 🚦 `PROMPT_02_ROTAS_PROTEGIDAS.md`
**(Acesso e Roteamento)**
**O que ele faz:** Cria o "Leão de Chácara" das páginas do seu aplicativo.
**Por que é genial:** Em sites normais, se você aperta "F5", às vezes o site pisca a tela de Login por meio segundo e te joga pra dentro de novo. Esse prompt ensina a IA a fazer o sistema *esperar silenciosamente* o banco de dados confirmar quem você é antes de desenhar a tela, igualzinho a um App de banco. Garante que quem estiver logado nunca veja a tela de Login por acidente.

---

## 03. �️ `PROMPT_03_PERMISSOES_E_PAPEIS.md`
**(Regras de Negócio e RLS)**
**O que ele faz:** Cria a hierarquia de Patentes e Perfis do seu sistema (Administrador vs Usuário Master vs Comum).
**Por que é genial:** Em sistemas amadores, a segurança é feita escondendo botões na tela. Um hacker consegue clicar no botão invisível. Esse prompt ensina a IA o Nível Ouro (RLS - Row Level Security): A regra é gravada lá no fundo do Banco. Uma IA é instruída a criar um escudo onde um usuário fica fisicamente proibido pelo Servidor de visualizar dados irrelevantes.

---

## 04. 🎨 `PROMPT_04_SISTEMA_DE_BOTOES_PADRAO.md`
**(Framework de Design e UX Padrão)**
**O que ele faz:** Ensina a IA a construir um sistema universal de "Peças de Lego" para a Interface, focado em Botões (`<Button>`), Cartões Brancos (`<Card>`) e Campos de Texto (`<Input>`).
**Por que é genial:** Quando IAs constroem telas gigantescas sem um "Framework" base, elas criam 50 botões diferentes e a interface vira um "Balaio de Gato". Esse prompt cria 1 "Botão de Ouro" que dita a lei para o site inteiro, mantendo botões simétricos, com mesmas sombras e comportamentos (como afundar ao apertar no celular).

---

## 05. 🚨 `PROMPT_05_MODAL_ALERTA_GLOBAL.md`
**(Identidade Visual e Comunicação)**
**O que ele faz:** Exclui do projeto da IA o velho botão feioso `alert('Deu certo')` padrão do Chrome e instiga a padronização de avisos no aplicativo pelo Central AlertModal.
**Por que é genial:** Mostrando Erros em Vermelho, Sucessos em Verde e Botões perigosos pedindo Confirmação. O Sistema para de se comunicar de 15 jeitos diferentes e centraliza a identidade em 1 canal principal limpo e estético.

---

## 06. 👥 `PROMPT_06_GESTAO_DE_USUARIOS_AVANCADA.md`
**(Funcionalidade B2B Impressionante)**
**O que ele faz:** Ensina a IA a construir telas de Administração de Usuários sofisticadas com Grade Interativa para Papéis (Super Admin, Visitante) e um revolucionário **Gerador de Usuários Temporários**.
**Por que é genial:** Ao invés do dono do site ter que criar uma conta inteira com e-mail real só para mostrar o portfólio para um cliente uma vez, o sistema gera e-mail e senha falsos (expira em 3 dias) e entrega na tela um botão "Copiar para WhatsApp" já com o texto montado.

---

## 07. 🖼️ `PROMPT_07_COMPRESSAO_IMAGEM_NAVEGADOR.md`
**(Otimização Pesada de Infraestrutura)**
**O que ele faz:** Ensina a IA a comprimir e diminuir fotos gigantes recém batidas pela câmera do celular do usuário ANTES de enviar pela internet.
**Por que é genial:** Se você não tiver isso, upload de fotos queima o banco de dados e gasta a cota do Servidor. Ao injetar essa aula técnica de Interceptamento "Canvas Web" no dispositivo, convertemos arquivos monstros em pequenos bloquinhos JPG de qualidade de 300 Kilobytes sem gastar recursos da rede.

---

## 08. � `PROMPT_08_BOTAO_VOLTAR_CELULAR.md`
**(Correção de UX Mobile Típica)**
**O que ele faz:** Intercepta (sequestra) a função física do botão "Voltar" (aquela setinha de baixo no Android) para que ele não feche o aplicativo na sua cara.
**Por que é genial:** Em aplicativos de internet (PWAs), apertar "Voltar" não fecha telas soltas, ele volta o navegador. Se apertar voltar, o celular te desloga brutalmente. Este prompt intercepta o botão físico e exibe um alerta amigável: *"Deseja Sair e Deslogar?"* - salvando o usuário.

---

## 09. 📱 `PROMPT_09_LIGHTBOX_FULLSCREEN_CELULAR.md`
**(Luxo Visual para Galerias)**
**O que ele faz:** Mágica pura de Pinça. Quando um cliente clica numa foto, a tela vira preta (Full Blackout) para exibir zoom na imagem focado nos dedos do Celular.
**Por que é genial:** A maioria das IAs tentariam instalar módulos gigantes antigos. Esta instrução ensina as coordenadas matemáticas do Gesto de Pinça Touch de Celular (`onTouchMove`, `Math.hypot()`) sem NENHUMA dependência externa, dando "Suporte de Visão Ouro".

---

## 10. 📄 `PROMPT_10_GERACAO_PDF_CELULAR.md`
**(Feature Específica e Suporte a Sistemas Nativos)**
**O que ele faz:** Ensina a IA a construir um Pop-up com 3 botões (Visualizar, Baixar e Compartilhar) logo após gerar um arquivo PDF em celulares.
**Por que é genial:** Em celulares, forçar um download silencioso de PDF falha e bloqueia. Esse prompt instrui o uso da tecnologia nativa do celular (`Web Share API`), permitindo que a própria bandeja do sistema abra (WhatsApp, AirDrop) já contendo o arquivo PDF embutido com 100% de margem de sucesso.

---

## 11. 🧭 `PROMPT_11_PRESERVACAO_DE_ESTADO_E_SCROLL_MOBILE.md`
**(Experiência Offline / Retorno Pós-Minimização)**
**O que ele faz:** Evita que a página recarregue do zero (dando F5 de repente) sempre que você minimiza o site no celular para responder um WhatsApp e depois volta para o navegador.
**Por que é genial:** Navegadores matam abas em segundo plano para economizar bateria. Esse Blueprint ensina a IA a injetar âncoras na Memória de Sessão Nativa, "Salvar Tudo" (Debounce Autosave) 0.5s após o usuário digitar. Quando o usuário volta do WhatsApp, o sistema recarrega tudo instantaneamente onde ele parou de rolar e digitar. O usuário nunca perde os rascunhos de seus formulários.

---

## 12. 🎥 `PROMPT_12_INTEGRACAO_VIDEOS_REDES_SOCIAIS.md`
**(Comunicação Backend Proxy Anti-CORS)**
**O que ele faz:** Ensina a IA a NUNCA buscar miniaturas do Reels no Instagram usando Javascript do cliente, para evitar o catastrófico bloqueio de CORS de domínios fechados.
**Por que é genial:** Se o seu futuro E-commerce precisar puxar fotos de Redes Sociais, esse Blueprint ensina a sua IA a arquitetar uma **Edge Function Oculta**. Um servidor age como detetive pela rede da Amazon, rouba a foto da miniatura em qualidade máxima direto da Meta, e devolve mascarado para a cara limpa do seu App sem ser bloqueado pela matriz de segurança.

---

## 13. 📜 `PROMPT_13_SCROLL_INFINITO_PAGINACAO_E_METADADOS.md`
**(Engenharia de Memória e Listas Infinitas)**
**O que ele faz:** Ensina a IA como lidar com tabelas contendo mais de 10.000 itens (Fotos, Clientes, Financeiro). Substitui o destrutivo "baixar tudo de uma vez" por um esqueleto de Scroll Infinito que carrega apenas 50 por vez quando você desliza o dedo.
**Por que é genial:** Se você tiver 10 mil fotos de um condomínio, seu celular congela tentando baixar todas. Mas se criarmos um App novo e o botão "Selecionar Tudo (As 10 mil)" for clicado, o banco também não aguenta. Esse Blueprint ensina como enganar o frontend: O sistema não baixa as 10 mil. Ele conta escondido (Head Counting), vira a chave virtual (`isAllSelected`), e se o cliente desmarcar 30 fotos na tela, nós apenas subimos para o servidor uma Lista Negra (`excludedIds`) ordenando: "Deleta tudo MENOS esses 30 da lista negra". Um design de App corporativo puro!

---

## 14. 🎯 `PROMPT_14_MELHORIA_MAPEAMENTO_PDF_E_SLOTS.md`
**(Arquitetura de Dados Dinâmica e PDFs Inteligentes)**
**O que ele faz:** Ensina a IA a parar de "chumbar" nomes de campos no código e usar **Slots Semânticos**. Ele cria uma ponte inteligente entre o que você digita e onde isso aparece no PDF.
**Por que é genial:** Se você mudar o desenho da sua folha de proposta amanhã, você não precisa de um programador para mexer no código do PDF. O sistema entende que "footer_cliente" é o cliente em qualquer lugar que ele esteja. Além disso, permite que você salve sua fonte preferida (ex: Century Gothic 12pt) e ela seja lembrada para sempre, tornando a geração de propostas automática e elegante.

---

## 15. 📐 `PROMPT_15_ADICAO_CAMPO_PROJETISTA.md`
**(Extensibilidade de Dados e Perfil)**
**O que ele faz:** Ensina a IA a adicionar um novo campo de texto ("Projetista Responsável") em todo o ecossistema do aplicativo, desde a criação da coluna no Banco de Dados até o campo de digitação na tela de usuários.
**Por que é genial:** Adicionar campos parece fácil, mas exige mexer em 4 lugares diferentes (Banco, Tipos, Serviço e Tela). Esse Blueprint garante que a IA faça a "cirurgia" completa sem esquecer de nenhum detalhe, mantendo o campo alinhado visualmente com o restante do sistema.

---

*(Toda vez que a IA criar um novo Prompt Mestre, ela está autorizada e instruída a atualizar este manual automaticamente para você!)*
