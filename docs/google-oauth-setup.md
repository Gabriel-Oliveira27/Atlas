# Configurar o login com Google

Passo a passo para obter `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` e
ligar o botão "Entrar com Google".

O código já está pronto e testado — falta apenas o `.env`. Enquanto isso
não acontece, o login por e-mail/CPF/telefone continua funcionando
normalmente.

---

## 1. Criar o projeto no Google Cloud

1. Abra <https://console.cloud.google.com>.
2. No seletor de projeto (topo da página), **Novo projeto**.
3. Nome: `Atlas`. Organização: deixe como está se for conta pessoal.
4. **Criar** e espere o projeto ficar selecionado no topo.

---

## 2. Configurar a tela de consentimento

Sem isso o Google recusa a criação da credencial.

1. Menu ☰ → **APIs e serviços** → **Tela de permissão OAuth**.
2. **Tipo de usuário: Externo** → **Criar**.
   - "Interno" só existe em contas Google Workspace e limitaria o login
     aos e-mails da sua organização.
3. Preencha o mínimo obrigatório:
   - **Nome do app:** `Atlas`
   - **E-mail de suporte:** o seu
   - **E-mail do desenvolvedor:** o seu
4. **Salvar e continuar**.
5. **Escopos:** não adicione nada. `email` e `profile` são escopos
   básicos e já vêm por padrão — é tudo que o Atlas pede.
6. **Salvar e continuar**.
7. **Usuários de teste:** adicione o seu Gmail e o de quem for testar.

   > Enquanto o app estiver em **Teste**, SÓ os e-mails desta lista
   > conseguem entrar. Qualquer outro recebe "app não verificado" e é
   > bloqueado. É a causa nº 1 de "configurei tudo e não entra".

8. **Salvar e continuar** → **Voltar ao painel**.

---

## 3. Criar as credenciais

1. **APIs e serviços** → **Credenciais** → **Criar credenciais** →
   **ID do cliente OAuth**.
2. **Tipo de aplicativo: Aplicativo da Web**.
3. **Nome:** `Atlas API` (só aparece para você).
4. **Origens JavaScript autorizadas** — adicione:

   ```
   http://localhost:3000
   http://localhost:3001
   http://localhost:3333
   ```

5. **URIs de redirecionamento autorizados** — este é o campo que
   importa. Adicione **exatamente**:

   ```
   http://localhost:3333/api/auth/google/callback
   ```

   > Precisa bater **caractere por caractere** com `GOOGLE_CALLBACK_URL`
   > do `.env`. Uma barra a mais no fim, `https` no lugar de `http` ou
   > porta diferente resultam em `redirect_uri_mismatch` — e a mensagem
   > de erro do Google mostra a URI que ele recebeu: compare com esta.

6. **Criar**.
7. Aparece um modal com **ID do cliente** e **Chave secreta do cliente**.
   Copie os dois agora — o secret pode ser consultado depois, mas é mais
   simples copiar de uma vez.

---

## 4. Colar no `.env`

Na raiz do projeto, no arquivo `.env` (não no `.env.example`):

```env
GOOGLE_CLIENT_ID=123456789012-abcdefghijk.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxx
GOOGLE_CALLBACK_URL=http://localhost:3333/api/auth/google/callback
```

O `.env` **não é versionado** — o secret não vai para o Git. Confira que
não há aspas nem espaços sobrando: a API valida o ambiente no boot, mas
uma aspa perdida no meio de uma string passa e quebra depois.

### Quando a API sair do localhost

O mesmo cliente serve para tudo — **um só, do tipo "Aplicativo da Web"**,
inclusive para o aplicativo Android. É a API que conversa com o Google; o
app apenas abre o navegador e recebe o resultado pelo deep link
`atlasapp://`. Um cliente do tipo "Android" só faria sentido se o app
falasse com o Google diretamente, que não é o caso aqui.

Some as URIs de cada ambiente onde a API rodar. Elas **convivem** — não
substitua as de localhost, senão o desenvolvimento para de funcionar.

**URIs de redirecionamento autorizados:**

```
http://localhost:3333/api/auth/google/callback
https://SEU-SERVICO.onrender.com/api/auth/google/callback
```

**Origens JavaScript autorizadas:**

```
http://localhost:3000
http://localhost:3001
https://atlas-academia.vercel.app
```

E no ambiente de **cada** instância da API, o `GOOGLE_CALLBACK_URL`
aponta para ela mesma:

```env
# no painel do Render
GOOGLE_CALLBACK_URL=https://SEU-SERVICO.onrender.com/api/auth/google/callback
OAUTH_SUCCESS_REDIRECT_WEB=https://atlas-academia.vercel.app/auth/callback
```

> O túnel do Cloudflare sorteia um subdomínio a cada execução, e o Google
> **não aceita curinga** em URI de redirecionamento. Login com Google
> pelo túnel exigiria recadastrar a URI toda vez — na prática, use o
> Google pela API hospedada (endereço fixo) e o login por senha quando
> estiver no túnel.

---

## 5. Reiniciar e verificar

```bash
pnpm --filter @atlas/api dev
```

No boot, o aviso `Google OAuth não configurado` deve **sumir**. Confirme
pela API:

```bash
curl http://localhost:3333/api/auth/providers
```

Esperado:

```json
{ "success": true, "data": { "google": true, "credentials": true, ... } }
```

Com `google: true`, a tela de login mostra o botão sozinha — o front lê
essa rota, não uma variável de ambiente própria.

Teste o fluxo completo abrindo no navegador:

```
http://localhost:3333/api/auth/google
```

Você vai para o Google, autoriza, e volta em
`http://localhost:3000/auth/callback#access_token=...` com os tokens no
**fragmento** da URL.

---

## Quando der errado

| Erro                                    | Causa                                                                                                             |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `redirect_uri_mismatch`                 | A URI cadastrada não bate com `GOOGLE_CALLBACK_URL`. A tela de erro do Google mostra a que ele recebeu — compare. |
| `access_blocked` / "app não verificado" | Seu e-mail não está na lista de **usuários de teste** (passo 2.7).                                                |
| `invalid_client`                        | `GOOGLE_CLIENT_ID` ou `SECRET` com espaço, aspas ou incompleto.                                                   |
| Volta para `/auth/error`                | A API recebeu o perfil mas falhou depois. Olhe o log da API — o `requestId` da resposta aparece lá.               |
| Login funciona, conta duplicada         | Não deveria acontecer: a API vincula pelo e-mail. Se acontecer, o e-mail do Google difere do cadastrado.          |

---

## Antes de publicar

- [ ] Trocar as URIs de `localhost` pelo domínio real (mantenha as de
      desenvolvimento se for continuar testando local).
- [ ] Publicar a tela de consentimento (**Publicar app**) — só então
      qualquer pessoa consegue entrar, sem a lista de teste.
- [ ] Se pedir escopos além de `email`/`profile`, o Google exige
      verificação, que leva dias. O Atlas não pede — não adicione escopo
      "por precaução".
- [ ] `GOOGLE_CLIENT_SECRET` só nas variáveis de ambiente do servidor.
      **Nunca** em `NEXT_PUBLIC_*`: qualquer coisa com esse prefixo vai
      para o navegador.

---

## O que acontece na primeira entrada

Vale saber para não estranhar:

- **E-mail já cadastrado** (por você ou pela academia): a conta Google é
  **vinculada** à existente. Não cria duplicata, e a pessoa mantém o
  histórico.
- **E-mail novo:** cria a conta com papel `USER`.
- **Conta criada pelo Google não tem senha.** Se essa pessoa tentar
  entrar por senha depois, recebe `PASSWORD_NOT_SET` e a tela deve
  oferecer o botão do Google. Para definir uma senha, ela usa
  `POST /api/auth/password` já autenticada (sem `currentPassword`, que é
  opcional justamente para este caso).

Detalhes do fluxo em [`auth-security.md`](auth-security.md).
