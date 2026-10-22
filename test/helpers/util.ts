import { HttpClient, type HttpClientOptions } from '../../src/api/HttpClient';
import type { FakeController } from './FakeController';

export function makeClient(fake: FakeController, overrides: Partial<HttpClientOptions> = {}): HttpClient {
    const client = new HttpClient({
        host: '127.0.0.1',
        port: overrides.port ?? fake.port,
        protocol: 'http',
        username: 'USER',
        password: 'secret-pw',
        timeoutMs: 2000,
        maxConcurrency: 2,
        retries: 2,
        backoffBaseMs: 1,
        backoffMaxMs: 4,
        verifyTls: true,
        ...overrides,
    });
    client.sleep = (): Promise<void> => Promise.resolve();
    return client;
}
