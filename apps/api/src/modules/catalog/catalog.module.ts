import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { redisStore } from 'cache-manager-redis-yet';

/**
 * Resolves Redis connection options from either a single REDIS_URL
 * (e.g. redis://:password@host:port) or the discrete REDIS_HOST /
 * REDIS_PORT / REDIS_PASSWORD env vars. REDIS_URL takes precedence.
 */
function resolveRedisConnection() {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      const parsed = new URL(redisUrl);
      return {
        host: parsed.hostname || 'localhost',
        port: parsed.port ? parseInt(parsed.port, 10) : 6379,
        password: parsed.password || undefined,
      };
    } catch {
      // fall through to discrete env vars if REDIS_URL is malformed
    }
  }

  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  };
}

@Module({
  imports: [
    CacheModule.registerAsync({
      useFactory: async () => {
        const { host, port, password } = resolveRedisConnection();
        return {
          store: await redisStore({
            socket: { host, port },
            ...(password ? { password } : {}),
          }),
        };
      },
    }),
  ],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
