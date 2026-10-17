/**
 * health.ts — GET /health. Cheapest possible endpoint; proves the API + Lambda work
 * end-to-end without touching DynamoDB or Bedrock. Returns status + version + a
 * correlation id.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { getCorrelationId } from '../lib/correlation';
import { ok } from '../lib/response';
import { log } from '../lib/logger';

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const correlationId = getCorrelationId(event.headers ?? {});
  log.info('health_check', { route: '/health', correlationId, status: 200 });
  return ok(
    { status: 'ok', service: 'cloud-yatra', version: process.env.APP_VERSION ?? '0.1.0' },
    correlationId,
  );
};
