# Mapass — iOS App

App nativo iOS (e Android) do Mapass feito em **React Native + Expo**.

## 📁 Estrutura

```
mobile/
├── App.tsx                  # Entry point
├── app.json                 # Expo config (bundle id, permissions, plugins)
├── eas.json                 # EAS Build profiles
├── src/
│   ├── api/                 # Cliente HTTP + tipos da API
│   │   ├── client.ts        # fetch wrapper com auth
│   │   ├── trips.ts         # endpoints de roteiros
│   │   └── purchases.ts     # stub RevenueCat
│   ├── auth/
│   │   ├── supabase.ts      # cliente Supabase
│   │   └── AuthContext.tsx  # provider + Apple/Google/email
│   ├── components/          # Button, Input, Card, Screen
│   ├── navigation/          # Stack + Tabs
│   ├── screens/             # 12 telas
│   └── theme/               # cores, tipografia, espaçamento
└── assets/                  # ícones, splash (PRECISAM SER TROCADOS)
```

## 🚀 Rodar em dev

```bash
cd mobile
npm install           # se ainda não rodou
npx expo start        # abre Metro bundler
# Pressione `i` para abrir no simulador iOS (precisa de Xcode)
# Ou escaneie o QR com Expo Go no seu iPhone
```

**Teste rápido no seu iPhone:** instale o app "Expo Go" da App Store e escaneie o QR.

## ⚙️ Variáveis de ambiente

Crie `.env` em `mobile/` (copiando de `.env.example`):

```
EXPO_PUBLIC_API_URL=https://voyara-api.onrender.com/api/v1
EXPO_PUBLIC_AI_URL=https://voyara-ai.onrender.com
EXPO_PUBLIC_SUPABASE_URL=https://ekodgupuhlytnikqgufb.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<pega no Supabase Dashboard>
EXPO_PUBLIC_REVENUECAT_IOS_KEY=<depois de configurar RevenueCat>
```

## 📋 Checklist antes de submeter pra App Store

### 1. Configuração Apple Developer
- [ ] Apple Developer Account ativa ($99/ano)
- [ ] Team ID copiado pra `eas.json` (`appleTeamId`)
- [ ] Bundle ID `app.mapass.travel` registrado no Apple Developer Portal
- [ ] Certificados e Provisioning Profiles (o EAS gera automático)

### 2. App Store Connect
- [ ] Criar app em https://appstoreconnect.apple.com (+)
- [ ] Preencher: nome, categoria (Viagens), idioma (Português BR + Inglês)
- [ ] Anotar o **Apple ID** (numérico) e colocar em `eas.json` (`ascAppId`)
- [ ] Criar produtos de assinatura:
  - `mapass_pro_monthly` — R$19,90/mês
  - `mapass_pro_annual` — R$149/ano
- [ ] Submeter pra aprovação dos IAPs (24-48h)

### 3. Ícones & Splash (URGENTE — precisa trocar)
Os arquivos em `assets/` são placeholders do Expo. Substitua por:
- [ ] `icon.png` — 1024x1024 PNG (sem transparência) — ícone do app
- [ ] `splash-icon.png` — 1242x2436 PNG — tela de abertura
- [ ] `adaptive-icon.png` — 1024x1024 (Android)
- [ ] `favicon.png` — 48x48 (web, opcional)

Recomendado: gerar no https://icon.kitchen (grátis) ou Figma.

### 4. Legal (obrigatório Apple)
- [ ] Página pública de Política de Privacidade (já aponta pra `voyara-n5q8.onrender.com/privacy`)
- [ ] Página pública de Termos de Uso (`/terms`)
- [ ] Ambas precisam estar no ar **antes** de submeter
- [ ] Email de suporte funcional em `app.mapass.app` (ou o que preferir — atualize em `ProfileScreen.tsx`)

### 5. Deletar conta (obrigatório Apple)
O código em `AuthContext.deleteAccount()` chama a Edge Function `delete-account` do Supabase. Precisa:
- [ ] Criar Edge Function no Supabase que:
  1. Deleta linhas em `trips`, `day_plans`, `itinerary_items` do user
  2. Chama `supabase.auth.admin.deleteUser(user_id)`
- [ ] Testar antes de submeter

### 6. Supabase
- [ ] Dar "Resume" no projeto (está pausado)
- [ ] Ir em Authentication → URL Configuration:
  - Site URL: `mapass://`
  - Redirect URLs: adicione `mapass://auth-callback`
- [ ] Providers → Google → Enable (já deve estar)
- [ ] Providers → Apple → Enable + adicionar Team ID e Key ID

### 7. RevenueCat (pagamentos)
- [ ] Criar conta em revenuecat.com (grátis até $10k MRR)
- [ ] Criar project "Mapass"
- [ ] Conectar com App Store Connect (gerar chave API In-App Purchase)
- [ ] Criar Entitlement `pro` com produtos monthly/annual
- [ ] Copiar API Key do iOS para `EXPO_PUBLIC_REVENUECAT_IOS_KEY`
- [ ] `npm install react-native-purchases`
- [ ] Implementar `src/api/purchases.ts` (substituir stub)

## 🏗️ Build

### Login no EAS
```bash
npm install -g eas-cli
eas login
eas build:configure  # configura o projeto na Expo
```

### Build de preview (testar no iPhone antes de submeter)
```bash
eas build --platform ios --profile preview
```

### Build de produção
```bash
eas build --platform ios --profile production
```

### Submit pra App Store
```bash
eas submit --platform ios --latest
```

## 🧪 Teste local rápido

```bash
npx expo start --ios   # abre simulador
```

Se der erro de Apple Sign In no simulador: **é esperado**. Só funciona em device real. Use Expo Go no seu iPhone pra testar.

## 📝 O que está implementado

- ✅ Splash + 3 slides de Onboarding
- ✅ Login (Apple + Google + Email/Senha)
- ✅ Home com lista de roteiros + pull to refresh
- ✅ Criar roteiro (destino + dias)
- ✅ Ver roteiro com mapa nativo + dias/items
- ✅ Análise de link (TikTok/IG/YT)
- ✅ Chat assistente IA
- ✅ Compartilhar via link público + share nativo
- ✅ Perfil com deletar conta (obrigatório Apple)
- ✅ Paywall com 2 planos

## 🚧 O que falta (em ordem de prioridade)

1. **Ícones reais** (1024x1024) — SEM isso a Apple rejeita
2. **Chaves do Supabase no .env** (senão o auth não funciona)
3. **Edge Function de deletar conta** (obrigatório Apple)
4. **RevenueCat integrado** (senão o paywall não vende)
5. **Implementar chat no backend** (`POST /chat` no ai_service)
6. **Implementar share no backend** (`POST /trips/:id/share` no Rails)
7. **Páginas Privacy/Terms no web app**

## 🐛 Debugging

- **Metro bundler travado**: `npx expo start -c` (limpa cache)
- **Simulador não abre**: abrir Xcode uma vez, aceitar licença
- **Apple Sign In não funciona no simulador**: normal, testa no device
- **Erro de CORS**: o Rails API precisa aceitar o domínio do Expo dev
