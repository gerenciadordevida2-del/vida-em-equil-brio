# Plano — Checkout Mercado Pago, VIP e Administração

## Diagnóstico (Fase 1)
- Existe: login Google (Supabase), perfis, dados do usuário em um bloco por conta com RLS de dono, assistente IA, rotas protegidas.
- Não existe: planos, preços, teste grátis, Mercado Pago, webhook, assinaturas, VIP, papéis, proprietário, painel admin.
- Tabelas atuais: `profiles` e `app_data` (cada usuário só vê/edita o próprio). Nada será apagado ou alterado nelas.

## Pendência antes de cobrar
- **Preços**: você enviou as descrições, mas não os valores. Informe o preço do VIP Mensal e do VIP Anual (em R$). Até lá, os preços ficam numa tabela do servidor e o checkout fica desativado.
- **Proprietário**: será definido pelo ID imutável da sua conta (não por e-mail), gravado em um secret do servidor `OWNER_USER_ID`.

## O que será construído
1. **Página Planos** (`/planos`): Gratuito, VIP Mensal, VIP Anual com seus textos, benefícios reais e o teste de 7 dias. Botão "Assinar" leva ao Checkout Pro.
2. **Teste grátis**: 7 dias de VIP uma única vez por conta, registrado no servidor.
3. **Checkout** (pagamento único por período, API de Preferências do Checkout Pro — compatível com pagamento único e com o webhook de pagamentos): o servidor lê o preço da tabela, cria o pedido como "pendente" com referência única, e só então gera o link. URLs de sucesso/pendência/falha apenas mostram mensagens; não liberam nada.
4. **Webhook** (`/api/public/mercadopago/webhook`): valida a assinatura `x-signature` com o segredo, consulta o pagamento na API oficial, confere referência, usuário, plano, valor e moeda (BRL), grava histórico, é idempotente (um pagamento aprovado gera um único período VIP). Reembolso/estorno revoga o período correspondente.
5. **Bloqueios VIP** (sem apagar nem esconder dados): Assistente IA, Gráficos/relatórios, aba Negócio e metas acima de um limite gratuito configurável (padrão: 3 metas financeiras e 3 de saúde). Dados antigos continuam visíveis; só a criação/uso avançado pede VIP.
6. **Admin** (`/admin`, só proprietário e administradores, verificado no servidor):
   - Usuários: busca por nome/e-mail, selo Gratuito/VIP/Admin, Conceder VIP (motivo obrigatório, início, fim ou permanente, confirmação), Revogar VIP.
   - Histórico: todas as concessões, revogações e alterações com responsável.
   - Vendas (só proprietário): receita bruta recebida, receita líquida (usa a tarifa informada pelo Mercado Pago; se ausente, "não calculada"), contagem por status, assinaturas ativas/vencidas, pagantes x VIP manual, receita por plano, gráfico, transações com filtros.
7. **Proprietário**: VIP permanente gratuito, nunca cobrado; admins comuns não podem mexer no proprietário nem em si mesmos.

## Detalhes técnicos
- Novas tabelas (todas com RLS; usuário só lê os próprios registros; nenhuma escrita pelo navegador): `user_roles` (enum admin), `plans`, `orders`, `payments`, `payment_events` (histórico/idempotência por id do evento e do pagamento), `vip_grants` (origem: pagamento/manual/teste/proprietário, início, fim, revogado), `admin_audit_log`.
- Status separados: pedido, pagamento e benefício VIP. VIP ativo = existe concessão não revogada vigente, ou usuário é o proprietário.
- Toda lógica em `createServerFn` com `requireSupabaseAuth` e rotas `/api/public/*` (padrão do projeto; não Edge Functions). Escritas privilegiadas com cliente admin só após checar papel no servidor.
- Secrets: `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `OWNER_USER_ID`.
- Regras puras (cálculo de período, idempotência, receita) em `src/lib/billing.ts` com testes: aprovado, pendente/recusado, assinatura inválida, notificação repetida, reembolso, expiração/revogação, acesso negado a não-admin.

## Configuração no Mercado Pago (você fará depois)
Criar aplicação, copiar Access Token, cadastrar a URL do webhook (evento "Pagamentos") e copiar a chave secreta da assinatura.

## Limites honestos
Sem credenciais e um pagamento de teste real, não declararei o checkout funcionando em produção.
