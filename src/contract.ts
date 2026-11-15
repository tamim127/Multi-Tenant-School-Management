import { OpenAPIObject } from '@nestjs/swagger';
import { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

const str: SchemaObject = { type: 'string' };
const uuid: SchemaObject = { type: 'string', format: 'uuid' };
const date: SchemaObject = { type: 'string', format: 'date-time' };
function object(properties: Record<string, SchemaObject>): SchemaObject {
  return { type: 'object', properties, required: Object.keys(properties) };
}
const user = object({
  id: uuid,
  email: { type: 'string', format: 'email' },
  displayName: str,
  createdAt: date,
});
const campus = object({ id: uuid, tenantId: uuid, name: str, code: str });
const member = object({
  id: uuid,
  tenantId: uuid,
  userId: uuid,
  campusId: { ...uuid, nullable: true },
  role: { type: 'string', enum: ['owner', 'admin', 'staff', 'viewer'] },
});
const tenant = object({
  id: uuid,
  name: str,
  slug: str,
  presetKey: { type: 'string', enum: ['school'] },
  presetVersion: { type: 'integer', enum: [1] },
  institutionType: str,
  settings: { type: 'object', additionalProperties: true },
});
const session = object({
  id: uuid,
  createdAt: date,
  expiresAt: date,
  revokedAt: { ...date, nullable: true },
});
const audit = object({
  id: uuid,
  tenantId: uuid,
  actorId: uuid,
  action: str,
  resourceId: { ...uuid, nullable: true },
  requestId: str,
  createdAt: date,
});
const academic = { type: 'object', additionalProperties: true } as SchemaObject;
const list = (items: SchemaObject) => object({ items: { type: 'array', items, maxItems: 100 } });

// Explicit output schemas prevent inferred empty responses and work with both tsc and tsx.
export function completeContract(document: OpenAPIObject) {
  for (const [path, entry] of Object.entries(document.paths)) {
    for (const method of ['get', 'post', 'patch', 'delete'] as const) {
      const operation = entry[method];
      if (!operation) continue;
      operation.parameters = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => ({
        name: match[1],
        in: 'path',
        required: true,
        schema: match[1] === 'resource' ? str : uuid,
      }));
      let schema: SchemaObject = object({ id: uuid });
      if (path.includes('/health/')) schema = object({ status: { type: 'string', enum: ['ok'] } });
      else if (path.endsWith('/login'))
        schema = object({
          accessToken: str,
          tokenType: { type: 'string', enum: ['Bearer'] },
          expiresAt: date,
          sessionId: uuid,
        });
      else if (path.endsWith('/register') || path.endsWith('/me')) schema = user;
      else if (path.endsWith('/sessions')) schema = list(session);
      else if (path.endsWith('/users')) schema = list(user);
      else if (path.endsWith('/permissions')) schema = list(object({ permission: str }));
      else if (path.endsWith('/audit-events')) schema = list(audit);
      else if (path.includes('/academic/')) {
        if (path.endsWith('/apply-preset')) schema = object({ applied: { type: 'boolean' } });
        else if (path.endsWith('/active'))
          schema = { type: 'object', additionalProperties: { type: 'array', items: academic } };
        else schema = method === 'get' ? list(academic) : academic;
      } else if (path.includes('/campuses')) schema = method === 'get' ? list(campus) : campus;
      else if (path.includes('/memberships')) schema = method === 'get' ? list(member) : member;
      else if (path === '/v1/tenants' && method === 'get')
        schema = list(object({ id: uuid, name: str, role: str }));
      else if (path === '/v1/tenants/{tenantId}') schema = tenant;
      const empty = method === 'delete' || path.endsWith('/logout');
      const status = empty
        ? '204'
        : method === 'post' && !path.endsWith('/login') && !path.endsWith('/archive')
          ? '201'
          : '200';
      operation.responses = {
        [status]: empty
          ? { description: 'Success, no content' }
          : { description: 'Success', content: { 'application/json': { schema } } },
      };
      for (const code of ['400', '401', '403', '404', '409', '429', '500', '503']) {
        operation.responses[code] = {
          description: 'See docs/api.md for error semantics',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  statusCode: { type: 'integer' },
                  message: { oneOf: [str, { type: 'object', additionalProperties: true }] },
                  requestId: str,
                },
              },
            },
          },
        };
      }
    }
  }
  return document;
}
