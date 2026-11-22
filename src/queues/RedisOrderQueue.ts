import { injectable } from 'inversify';
import { createClient } from 'redis';
import logger from '../lib/logger';
import { Order } from '../domain/Order';
import { IOrderQueue } from './IOrderQueue';

export const ORDER_QUEUE_KEY = 'orders:email';

@injectable()
export class RedisOrderQueue implements IOrderQueue {
  private client: ReturnType<typeof createClient>;

  constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });

    this.client.on('error', (err) => {
      logger.error(`Erro no cliente Redis: ${err.message}`);
    });
  }

  private async ensureConnected(): Promise<void> {
    if (!this.client.isOpen) {
      await this.client.connect();
    }
  }

  async publish(order: Order): Promise<void> {
    await this.ensureConnected();
    await this.client.lPush(ORDER_QUEUE_KEY, JSON.stringify(order));
    logger.info(`Pedido #${order.id} publicado na fila ${ORDER_QUEUE_KEY}`);
  }
}
