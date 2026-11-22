import 'reflect-metadata';
import 'dotenv/config';
import { createClient } from 'redis';
import { container } from './container/container';
import { NotificationService } from './services/NotificationService';
import { ORDER_QUEUE_KEY } from './queues/RedisOrderQueue';
import { Order } from './domain/Order';
import logger from './lib/logger';

const notificationService = container.get(NotificationService);

async function startWorker() {
  const client = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  });

  client.on('error', (err) => {
    logger.error(`Erro no Redis do worker: ${err.message}`);
  });

  await client.connect();
  logger.info(`Worker conectado ao Redis. Aguardando pedidos na fila "${ORDER_QUEUE_KEY}"...`);

  let running = true;

  const shutdown = () => {
    running = false;
    logger.info('Encerrando worker...');
    client.destroy();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  while (running) {
    try {
      const result = await client.brPop(ORDER_QUEUE_KEY, 0);
      if (!result) continue;

      const order: Order = JSON.parse(result.element);
      logger.info(`Processando e-mail do pedido #${order.id} para ${order.customer}`);

      const emailPreview = await notificationService.orderConfirmed(order);
      logger.info(`Email enviado para pedido #${order.id}: ${emailPreview}`);
    } catch (error: any) {
      if (!running) break;
      logger.error(`Erro ao processar mensagem da fila: ${error.message}`);
    }
  }
}

startWorker().catch((error) => {
  logger.error(`Falha fatal ao iniciar worker: ${error.message}`);
  process.exit(1);
});
