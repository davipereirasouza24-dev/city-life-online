# City Life Online 2D

Cidade vista de cima, multiplayer em tempo real (até 16 jogadores por sala).

## Instalar e rodar
Requer Node.js 18+.

```bash
npm install
npm start
```
Abra http://localhost:3000

Para mudar o limite de jogadores: `MAX_PLAYERS=8 npm start`

## Como seus amigos entram

**Mesma rede (Wi-Fi):** descubra o IP do seu PC (`ipconfig` no Windows) e passe `http://SEU_IP:3000`.

**Pela internet, teste rápido (PC ligado):** com o servidor rodando, em outro terminal:
```bash
npx cloudflared tunnel --url http://localhost:3000
```
Ele mostra um link `https://...trycloudflare.com`. Envie para os amigos.

**Pela internet, definitivo:** publique em Render, Railway ou Fly.io.
No Render: crie um "Web Service" a partir do repositório no GitHub, Build `npm install`, Start `npm start`. O link gerado é o que você passa aos amigos.

## Controles
WASD move · Shift corre · Enter abre o chat

## Próximos passos
Veículos, contas com login e banco de dados, amigos, economia, missões.
