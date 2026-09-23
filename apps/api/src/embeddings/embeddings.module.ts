import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { EMBEDDING_PROVIDER, HashEmbeddingProvider, OpenAIEmbeddingProvider } from './embedding.provider';
import { EmbeddingsService } from './embeddings.service';

@Global()
@Module({
  providers: [
    EmbeddingsService,
    {
      provide: EMBEDDING_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) =>
        c.EMBEDDINGS_PROVIDER === 'openai' && c.OPENAI_API_KEY
          ? new OpenAIEmbeddingProvider(c.OPENAI_API_KEY, c.OPENAI_EMBEDDING_MODEL)
          : new HashEmbeddingProvider(),
    },
  ],
  exports: [EmbeddingsService],
})
export class EmbeddingsModule {}
