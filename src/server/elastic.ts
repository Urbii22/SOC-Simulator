import { Client } from '@elastic/elasticsearch';
import type { SecurityEvent } from '../domain/types.js';

export async function syncEventsToElastic(events: SecurityEvent[], endpoint: string): Promise<number> {
  const client = new Client({ node: endpoint });
  try {
    const index = 'soc-training-events';
    const exists = await client.indices.exists({ index });
    if (!exists) {
      await client.indices.create({
        index,
        settings: { number_of_replicas: 0 },
        mappings: {
          properties: {
            timestamp: { type: 'date' }, scenarioId: { type: 'keyword' }, source: { type: 'keyword' },
            host: { type: 'keyword' }, user: { type: 'keyword' }, sourceIp: { type: 'ip', ignore_malformed: true },
            destinationIp: { type: 'ip', ignore_malformed: true }, eventCode: { type: 'keyword' },
            action: { type: 'keyword' }, outcome: { type: 'keyword' }, message: { type: 'text' }, tags: { type: 'keyword' },
          },
        },
      });
    }
    const operations = events.flatMap((item) => [{ index: { _index: index, _id: item.id } }, item]);
    const result = await client.bulk({ refresh: true, operations });
    if (result.errors) throw new Error('Elasticsearch rejected one or more training events');
    return events.length;
  } finally {
    await client.close();
  }
}
