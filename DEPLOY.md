# 🚀 Mapass — Roteiro de Deploy (3 dias até App Store)

Este é o checklist mestre. Siga em ordem. Cada passo tem **comando exato** ou **link direto**.

---

## ⏰ Hoje (Dia 0)

### 1. Resume Supabase
- Abra https://supabase.com/dashboard/project/ekodgupuhlytnikqgufb
- Clique em **Resume project** (verde)
- Espere 1-2 min até voltar ao normal

### 2. Configure URLs no Supabase
- Authentication → URL Configuration:
  - **Site URL**: `https://voyara-n5q8.onrender.com`
  - **Redirect URLs** (uma por linha):
    ```
    https://voyara-n5q8.onrender.com/**
    mapass://
    mapass://auth-callback
    ```
- **Save**

### 3. Apple Provider no Supabase
- Authentication → Providers → Apple → Enable
- Você precisa do seu **Apple Team ID** e **Key ID** + **Private Key (.p8)** do Apple Developer
- Tutorial: https://supabase.com/docs/guides/auth/social-login/auth-apple

### 4. Deploy backend (Rails) com migration
```bash
cd backend
git push   # Render faz deploy auto
# Aguarde Render terminar deploy
# Acesse Shell do Render (paga $7) OU rode local:
RAILS_ENV=production bundle exec rails db:migrate
```

> Se Shell é pago e você não quer pagar, pode rodar a migration localmente apontando pro Postgres do Render. Me chama se precisar.

### 5. Deploy Edge Function (delete-account)
```bash
# Instalar Supabase CLI (uma vez)
brew install supabase/tap/supabase

# Login
supabase login

# Link ao projeto
cd /Users/shayne/Documents/github/ai-itinery
supabase link --project-ref ekodgupuhlytnikqgufb

# Deploy a function
supabase functions deploy delete-account

# Setar secrets que ela precisa
supabase secrets set RAILS_API_URL=https://voyara-api.onrender.com/api/v1
supabase secrets set RAILS_SERVICE_KEY=voyara-service-key-prod-2026
```

### 6. Testar app no iPhone
```bash
cd mobile
npx expo start --tunnel
# Instale "Expo Go" na App Store
# Escaneie QR ou cole URL do tunnel manualmente
```

---

## 📅 Dia 1 — Apple Developer + RevenueCat

### 1. Apple Developer Account
- Confirme que sua conta está ativa em https://developer.apple.com/account
- Anote seu **Team ID** (canto superior direito da tela)
- Edite `mobile/eas.json` linha `appleTeamId`

### 2. App ID no Apple Developer Portal
- https://developer.apple.com/account/resources/identifiers/list
- **+** → App IDs → App
- Bundle ID: `app.mapass.travel`
- Capabilities: **Sign In with Apple** ✅
- Continue → Register

### 3. Criar App no App Store Connect
- https://appstoreconnect.apple.com/apps → **+** → **New App**
- Platform: iOS
- Name: **Mapass**
- Primary Language: Português (Brasil)
- Bundle ID: `app.mapass.travel` (selecione o que criou)
- SKU: `mapass-ios-2026`
- User Access: Full Access
- Anote o **Apple ID** (numérico, na URL após criar) → cole em `mobile/eas.json` linha `ascAppId`

### 4. Criar produtos IAP
- App Store Connect → seu app → **Recursos** → **Compras no app** → **+**
- **Auto-Renewable Subscription**:

  **Mensal:**
  - Reference Name: `Mapass Pro Monthly`
  - Product ID: `mapass_pro_monthly`
  - Subscription Group: `Mapass Pro`
  - Subscription Duration: 1 month
  - Price: R$ 19,90

  **Anual:**
  - Reference Name: `Mapass Pro Annual`
  - Product ID: `mapass_pro_annual`
  - Add to existing group: `Mapass Pro`
  - Subscription Duration: 1 year
  - Price: R$ 149,00

- Para cada produto: preencher localizações (PT-BR + EN-US), display name, descrição
- **Enviar para revisão** (junto com o app)

### 5. RevenueCat
- https://app.revenuecat.com → **Create Project** → "Mapass"
- **Apps** → **+** → iOS
  - Bundle ID: `app.mapass.travel`
  - Cole **API Key específica do iOS** (App Store Connect → Users → Keys → In-App Purchase) — siga o wizard
- **Products** → Importar do App Store Connect (vai puxar `mapass_pro_monthly` e `mapass_pro_annual`)
- **Entitlements** → **+** → ID: `pro` → adicionar os 2 produtos
- **Offerings** → **+** → Identifier: `default` → adicionar os 2 produtos como packages
- **API Keys** (lateral) → copiar **Public iOS SDK Key**
- Edite `mobile/.env`:
  ```
  EXPO_PUBLIC_REVENUECAT_IOS_KEY=appl_xxxxxxxxxxxx
  ```

---

## 📅 Dia 2 — Build + Screenshots

### 1. Login no EAS
```bash
cd mobile
npm install -g eas-cli
eas login
eas init  # cria projectId e atualiza app.json
```

### 2. Configure credenciais Apple no EAS
```bash
eas credentials
# Selecione iOS → production
# EAS pergunta as credenciais Apple e salva
```

### 3. Build de preview (testar no iPhone real)
```bash
eas build --platform ios --profile preview
# Demora ~15-20 min na nuvem
# Quando terminar, baixe o .ipa via TestFlight ou link
```

### 4. Build de produção
```bash
eas build --platform ios --profile production
# Mesmo processo, mas otimizado para release
```

### 5. Screenshots (5 obrigatórios)
- iPhone 6.7" (1290x2796) — iPhone 15 Pro Max
- iPhone 6.5" (1284x2778) — opcional
- Use o simulador: `npx expo run:ios --device "iPhone 15 Pro Max"`
- Cmd+S para captura no simulador
- 5 telas recomendadas:
  1. Tela inicial (Home com roteiros)
  2. Roteiro com mapa (TripDetail)
  3. Análise de link (LinkAnalysis com resultado)
  4. Chat assistente
  5. Onboarding slide 1

### 6. Metadata na App Store Connect
- App Store → seu app → preencher:
  - **Promotional Text** (170 chars): "Cole um vídeo, ganhe um roteiro"
  - **Description** (4000 chars): copie do landing page
  - **Keywords** (100 chars): "viagem,roteiro,planejamento,IA,turismo,maps,tiktok,instagram"
  - **Support URL**: `https://voyara-n5q8.onrender.com`
  - **Marketing URL**: `https://voyara-n5q8.onrender.com`
  - **Privacy Policy URL**: `https://voyara-n5q8.onrender.com/privacy`
  - **Categoria**: Viagens
  - **Idade**: 4+
  - **Sign in with Apple**: ativado
  - **App Privacy** (questionário) — responda honestamente

---

## 📅 Dia 3 — Submit + esperar review

### 1. Submit
```bash
cd mobile
eas submit --platform ios --latest
# EAS faz upload do .ipa pra App Store Connect
```

### 2. Selecionar build no App Store Connect
- App Store Connect → seu app → versão 1.0 → **Build** (+) → selecionar o que subiu
- Salvar
- **Add for Review** → **Submit for Review**

### 3. Esperar
- Review da Apple: **24h - 7 dias** (geralmente 1-2 dias)
- Se rejeitar: ler motivo no App Store Connect → corrigir → resubmit (24h cada round)

---

## ✅ Checklist de coisas que costumam ser rejeitadas

Antes de submeter, confira:
- [ ] App não trava nas primeiras 5 telas
- [ ] Tem Sign in with Apple (obrigatório se tem Google)
- [ ] Tem botão "Deletar conta" funcional (testar)
- [ ] Privacy URL está no ar e fala dos dados que você coleta
- [ ] Terms URL está no ar
- [ ] Apple consegue testar tudo (criar conta de teste e mandar credenciais no review notes)
- [ ] Paywall mostra: preço claro, "renova automaticamente", link pros termos, "Restaurar compras"
- [ ] App funciona offline minimamente (mostra erro amigável)
- [ ] Permissões pedidas têm justificativa clara (já está no Info.plist)

---

## 🆘 Se algo der errado

**Build falhou:**
- `eas build:view` → ver logs
- Erro mais comum: certificado Apple → `eas credentials` → reset

**App rejeitado:**
- Leia o motivo (geralmente claro)
- Corrija → `eas build` → `eas submit` → "Submit for Review" novamente
- Cada round é 24-72h adicionais

**Tem dúvida em qualquer passo:**
- Volte aqui e me chama com print do erro
