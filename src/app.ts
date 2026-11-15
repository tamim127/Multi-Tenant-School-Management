import 'reflect-metadata';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Database } from './database';
import { SessionGuard } from './auth';
import { completeContract } from './contract';
import { AcademicController } from './academic';
import {
  AuthController,
  HealthController,
  TenantsController,
  UsersController,
} from './controllers';

@Catch()
class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    let status = 500;
    let message: unknown = 'Internal server error';
    if (error instanceof HttpException) {
      status = error.getStatus();
      message = error.getResponse();
    } else {
      const wrapped = error as { code?: string; cause?: { code?: string } };
      const code = wrapped?.cause?.code ?? wrapped?.code;
      if (code === '23505') {
        status = 409;
        message = 'Resource already exists';
      }
      if (code === '23503' || code === '23514' || code === '22023') {
        status = 400;
        message = 'Invalid relationship or value';
      }
      if (code === '42501') {
        status = 403;
        message = 'Permission denied';
      }
    }
    reply.status(status).send({ statusCode: status, message, requestId: request.id });
  }
}
@Module({
  controllers: [
    AuthController,
    HealthController,
    TenantsController,
    UsersController,
    AcademicController,
  ],
  providers: [Database, SessionGuard],
})
export class AppModule {}
export async function createApp(verifyDatabase = true) {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 16384, requestIdHeader: false }),
    { logger: ['error', 'warn'] },
  );
  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new Errors());
  await app.register(helmet);
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Education SaaS Phase 0–1')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build(),
  );
  completeContract(document);
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'openapi.json' });
  app.enableShutdownHooks();
  if (verifyDatabase) await app.get(Database).verifyRole();
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, document };
}
