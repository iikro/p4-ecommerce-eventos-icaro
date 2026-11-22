# ADR 001: Fila de Envio de E-mails com Lista do Redis (`LPUSH` / `BRPOP`)

## Contexto

Na implementação anterior do e-commerce, a rota `POST /orders` executava o envio do e-mail de confirmação de forma síncrona dentro do `OrderService`, chamando diretamente o `NotificationService`. Esse acoplamento temporal gerava dois problemas críticos:

1. **Alta latência na resposta da API:** o cliente precisava aguardar o término da comunicação com o servidor SMTP (Ethereal) para receber a confirmação do pedido.
2. **Baixa resiliência:** qualquer falha ou indisponibilidade no provedor de e-mail fazia a requisição de criação de pedido falhar, mesmo após o pagamento e a gravação do pedido no banco de dados.

Para desacoplar o processamento do pedido do envio de e-mail, tornou-se necessário introduzir uma comunicação assíncrona entre a API e um processo consumidor independente (`worker`) utilizando o Redis.

## Decisão

Adotamos uma **lista do Redis** operada como fila FIFO por meio dos comandos **`LPUSH`** (produtor, na API via `RedisOrderQueue`) e **`BRPOP`** (consumidor, no `src/worker.ts`), em vez do mecanismo de **Publish/Subscribe (`PUBLISH` / `SUBSCRIBE`)** do Redis.

Os motivos técnicos dessa escolha são:

- **Retenção de mensagens com o worker indisponível:** o Pub/Sub do Redis funciona no modelo *fire-and-forget* — se nenhum assinante estiver conectado no momento da publicação, a mensagem é descartada permanentemente. Com listas (`LPUSH` / `BRPOP`), os pedidos permanecem armazenados na fila do Redis enquanto o worker estiver parado e são processados assim que ele retorna.
- **Consumo exclusivo ao escalar workers (Competing Consumers):** o `BRPOP` remove e retorna atomicamente o item para **apenas um** worker. Isso permite escalar horizontalmente (por exemplo, `docker compose up -d --scale worker=2`) garantindo que cada pedido gere apenas um e-mail. No Pub/Sub, toda mensagem é entregue em *broadcast* para todos os assinantes ativos, o que causaria o envio de e-mails duplicados.
- **Consumo eficiente sem polling ativo:** o `BRPOP` bloqueia a conexão do worker até que um novo item chegue na lista, evitando loops de consulta contínua que desperdiçariam CPU e rede.
- **Inversão de dependência mantida:** o `OrderService` depende apenas da interface `IOrderQueue`, mantendo a camada de serviços desacoplada da infraestrutura do Redis.

## Consequências

### Positivas
- **Resposta imediata da API:** `POST /orders` persiste o pedido, enfileira o evento no Redis e responde sem aguardar o envio SMTP.
- **Isolamento de falhas:** instabilidades no serviço de e-mail não derrubam nem atrasam a criação de pedidos na API.
- **Resiliência a paradas do consumidor:** pedidos criados enquanto o worker está offline não são perdidos e são processados automaticamente quando o worker volta.
- **Escalabilidade horizontal segura:** múltiplos workers podem consumir a mesma fila em paralelo sem duplicar envios de e-mail.

### Negativas e trade-offs
- **Consistência eventual:** o envio do e-mail deixa de acontecer dentro da mesma requisição HTTP; a resposta da API não contém mais o link de preview do e-mail, que passa a aparecer nos logs do worker.
- **Complexidade operacional adicional:** o ambiente agora exige o gerenciamento e o monitoramento dos serviços `redis` e `worker`.
- **Sem confirmação de entrega (ACK) nativa:** como o `BRPOP` remove o item da lista no momento da leitura, se o worker cair abruptamente durante o envio do e-mail, aquela mensagem pode ser perdida. Em evoluções futuras, o padrão pode ser estendido com `BLMOVE` (fila de processamento + *dead-letter queue*) ou Redis Streams.
