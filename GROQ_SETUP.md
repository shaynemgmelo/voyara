# 🔑 Groq API — transcrição de áudio dos vídeos (grátis)

Para a ferramenta capturar TUDO que é **falado** nos vídeos dos links (e não só o que aparece escrito na tela), precisamos de uma chave gratuita da Groq.

**Sem essa chave**, apenas texto sobreposto e caption são lidos — vídeos narrados (como guias de 3 dias) perdem a maior parte dos lugares.

## Passos (2 minutos)

### 1. Criar conta Groq (grátis)

1. Acesse https://console.groq.com/login
2. Entre com Google ou email
3. Não precisa cartão de crédito

### 2. Gerar API key

1. Vá em https://console.groq.com/keys
2. Clique **"Create API Key"**
3. Dê um nome (ex: `mapass-whisper`)
4. Copie a chave (começa com `gsk_...`)

### 3. Adicionar no Render

1. Acesse https://dashboard.render.com
2. Selecione o serviço **voyara-ai**
3. Aba **Environment**
4. **Add Environment Variable**:
   - Key: `GROQ_API_KEY`
   - Value: cole a chave `gsk_...`
5. **Save Changes** — o serviço reinicia sozinho em ~30s

## Limites gratuitos da Groq

- **Whisper Large v3 Turbo**: grátis até ~14.000 segundos de áudio por dia
- Nosso cap é 10 min por vídeo — dá para analisar **~80 vídeos/dia de graça**
- Sem cobrança, sem bill shock

## Verificar se funcionou

Depois de configurar, cole um link de um vídeo narrado. No resultado da análise, o campo `debug.has_transcript` deve ficar `true`. Antes: `false`.

Cobertura esperada:
- **Sem Groq**: 6-10 lugares por vídeo (só caption + overlay)
- **Com Groq**: 20-30+ lugares (caption + overlay + **TUDO que é falado**)
