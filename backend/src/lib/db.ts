/**
 * db.ts — a single shared DynamoDB Document client.
 *
 * Created once per Lambda container (module scope) so warm invocations reuse it.
 * The table name comes from the TABLE_NAME env set by the SAM template.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
export const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

export const TABLE_NAME = process.env.TABLE_NAME ?? 'cy_data';
