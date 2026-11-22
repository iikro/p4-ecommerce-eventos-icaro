# E-commerce — Projeto 4

API de e-commerce em Node.js + TypeScript + Prisma + PostgreSQL com envio assíncrono de e-mails desacoplado via fila no **Redis** (`LPUSH` / `BRPOP`) e um **worker** dedicado em container separado.

## Arquitetura

- **API (`api`)**: recebe `POST /orders`, processa pagamento, grava o pedido no PostgreSQL, publica o pedido na fila `orders:email` do Redis por meio da interface `IOrderQueue` (`RedisOrderQueue`) e responde imediatamente.
- **Worker (`worker`)**: consome a fila `orders:email` com `BRPOP` e envia o e-mail de confirmação utilizando o `NotificationService` resolvido pelo container Inversify.
- **PostgreSQL (`banco`)**: persistência dos produtos e pedidos.
- **Redis (`redis`)**: fila de mensagens interna na rede Docker (sem porta publicada para o host).
- **ADR**: a decisão arquitetural pelo uso de lista do Redis (`LPUSH` / `BRPOP`) em vez de Pub/Sub está documentada em [docs/adr-001-fila-de-email.md](docs/adr-001-fila-de-email.md).

## Como rodar

1. Clone o repositório e crie o arquivo `.env`:

```bash
git clone https://github.com/iikro/p4-ecommerce-eventos-icaro.git
cd p4-ecommerce-eventos-icaro
cp .env.example .env
```

2. Suba todos os serviços (`banco`, `redis`, `api` e `worker`):

```bash
docker compose up --build
```

> Para rodar em segundo plano, use `docker compose up -d --build`.

A API sobe em `http://localhost:3000`.

## Como testar

### 1. Criar um pedido (`POST /orders`)

```bash
curl -X POST http://localhost:3000/orders \
-H "Content-Type: application/json" \
-d '{
  "customer": "cliente@ethereal.email",
  "items": [{ "productId": 1, "quantity": 1 }],
  "paymentMethod": "pix"
}'
```

A API responde imediatamente sem aguardar o envio do e-mail. Para acompanhar o envio e o link de preview do Ethereal nos logs do worker:

```bash
docker compose logs -f worker
```

### 2. Consultar um pedido (`GET /orders/:id`)

```bash
curl http://localhost:3000/orders/1
```

### 3. Testar resiliência com o worker parado

Pare o worker, envie novos pedidos (eles ficam aguardando na fila do Redis) e suba o worker novamente para vê-los sendo enviados:

```bash
docker compose stop worker
# envie um ou mais POST /orders
docker compose start worker
docker compose logs -f worker
```

### 4. Testar escala horizontal com dois workers

```bash
docker compose up -d --scale worker=2
```

Envie múltiplos pedidos e acompanhe os logs com `docker compose logs -f worker`: os pedidos são distribuídos entre `worker-1` e `worker-2`, e cada pedido gera apenas um e-mail.

### Encerrar os containers

```bash
docker compose down
```
