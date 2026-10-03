import { QdrantClient } from '@qdrant/js-client-rest';
import { readFileSync } from 'fs';
import { logger } from '../../utils/structured-logger.js';
import { parseBooleanEnv } from './utils.js';
import { SquadrulesError } from '../../types/index.js';

/**
 * QdrantConnection encapsulates client initialization and resilient execution.
 * Other service modules receive a QdrantConnection instance and call executeWithReconnect().
 */
export class QdrantConnection {
  public client!: QdrantClient;
  public collectionName: string;
  public originalCollectionAlias?: string;
  public qdrantUrl: string;
  public apiKey: string;
  public caCertPath: string | undefined;
  public rescoreEnabled: boolean = true;
  private isHealthy: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;

  constructor(
    qdrantUrl: string = process.env['QDRANT_URL'] || 'http://localhost:6333',
    apiKey: string = process.env['QDRANT_API_KEY'] || '',
    collectionAlias: string = process.env['QDRANT_COLLECTION'] || 'squadrules',
    caCertPath?: string
  ) {
    this.qdrantUrl = qdrantUrl;
    this.apiKey = apiKey;
    this.originalCollectionAlias = collectionAlias;
    this.collectionName = collectionAlias;
    this.caCertPath = caCertPath || process.env['QDRANT_CA_CERT_PATH'];
    this.rescoreEnabled = parseBooleanEnv('QDRANT_RESCORE', true);
    this.initializeClient();
  }

  initializeClient(): void {
    const clientParams: any = { url: this.qdrantUrl };
    if (this.apiKey) clientParams.apiKey = this.apiKey;

    if (this.qdrantUrl.startsWith('https://')) {
      if (this.caCertPath) {
        try {
          const caCert = readFileSync(this.caCertPath, 'utf-8');
          clientParams.ca = caCert;
          clientParams.rejectUnauthorized = true;
          logger.info(`Qdrant TLS: Using custom CA certificate from ${this.caCertPath}`);
        } catch (error) {
          logger.error(`Failed to load CA certificate from ${this.caCertPath}`, error instanceof Error ? error.message : String(error));
          throw new Error(`Cannot load Qdrant CA certificate: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        clientParams.rejectUnauthorized = true;
        logger.info('Qdrant TLS: Using system CA certificates');
      }
    }

    this.client = new QdrantClient(clientParams);
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.client.getCollections();
      this.isHealthy = true;
      this.reconnectAttempts = 0;
      return true;
    } catch (error) {
      this.isHealthy = false;
      logger.warn(`Qdrant health check failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private async attemptReconnect(): Promise<boolean> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error(`Max reconnection attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
      return false;
    }
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    logger.info(`Attempting to reconnect to Qdrant (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms...`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      this.initializeClient();
      const ok = await this.checkHealth();
      if (ok) {
        logger.info('Successfully reconnected to Qdrant');
        return true;
      }
    } catch (err) {
      logger.warn(`Reconnection attempt ${this.reconnectAttempts} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return false;
  }

  async executeWithReconnect<T>(operation: () => Promise<T>): Promise<T> {
    try {
      if (!this.isHealthy) await this.checkHealth();
      return await operation();
    } catch (error) {
      if (error instanceof SquadrulesError) throw error;

      const errorDetails = error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
        ...(error as any)
      } : { type: typeof error, value: String(error) };

      logger.error(`Qdrant operation failed - ${operation.name || 'operation'}, Error: ${errorDetails.message || errorDetails.value}`, {
        error: errorDetails,
        collection: this.collectionName,
        qdrantUrl: this.qdrantUrl,
        timestamp: new Date().toISOString()
      });

      if (await this.attemptReconnect()) {
        try {
          return await operation();
        } catch (retryError) {
          if (retryError instanceof SquadrulesError) throw retryError;
          const retryDetails = retryError instanceof Error ? { message: retryError.message, stack: retryError.stack } : retryError;
          throw new SquadrulesError(`Operation failed after reconnection: ${JSON.stringify(retryDetails, null, 2)}`, 'QDRANT_OPERATION_ERROR', 500);
        }
      }
      throw new SquadrulesError(`Qdrant is unavailable after ${this.maxReconnectAttempts} attempts`, 'QDRANT_UNAVAILABLE', 503);
    }
  }
}