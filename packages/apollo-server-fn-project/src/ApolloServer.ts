import { ApolloServerBase } from 'apollo-server-core';
import fdk, { Context, HTTPGatewayContext } from '@fnproject/fdk';
import type { GraphQLOptions } from 'apollo-server-core';
import { graphqlFnFunction } from './fnFunctionApollo';
import type { LandingPage } from 'apollo-server-plugin-base';

export interface CreateHandlerOptions {
  cors?: {
    origin?: boolean | string | string[];
    methods?: string | string[];
    allowedHeaders?: string | string[];
    exposedHeaders?: string | string[];
    credentials?: boolean;
    maxAge?: number;
  };
  disableHealthCheck?: boolean;
  onHealthCheck?: (req: any) => Promise<any>; // TODO
}

export type Headers = Record<string, any>;
export interface ResponseObject {
  body: string | Buffer | Error | unknown;
  status: number;
  headers?: Headers
}

export class ApolloServer extends ApolloServerBase {
  protected override serverlessFramework(): boolean {
    return true;
  }

  // This translates the arguments from the middleware into graphQL options It
  // provides typings for the integration specific behavior, ideally this would
  // be propagated with a generic to the super class
  createGraphQLServerOptions(
    request: any, // TODO
    context: HTTPGatewayContext,
  ): Promise<GraphQLOptions> {
    return super.graphQLServerOptions({ request, context });
  }

  public createHandler({
    cors,
    onHealthCheck,
    disableHealthCheck,
  }: CreateHandlerOptions = {}) {
    const staticCorsHeaders: Headers = {};

    if (cors) {
      if (cors.methods) {
        if (typeof cors.methods === 'string') {
          staticCorsHeaders['Access-Control-Allow-Methods'] = cors.methods;
        } else if (Array.isArray(cors.methods)) {
          staticCorsHeaders['Access-Control-Allow-Methods'] =
            cors.methods.join(',');
        }
      }

      if (cors.allowedHeaders) {
        if (typeof cors.allowedHeaders === 'string') {
          staticCorsHeaders['Access-Control-Allow-Headers'] =
            cors.allowedHeaders;
        } else if (Array.isArray(cors.allowedHeaders)) {
          staticCorsHeaders['Access-Control-Allow-Headers'] =
            cors.allowedHeaders.join(',');
        }
      }

      if (cors.exposedHeaders) {
        if (typeof cors.exposedHeaders === 'string') {
          staticCorsHeaders['Access-Control-Expose-Headers'] =
            cors.exposedHeaders;
        } else if (Array.isArray(cors.exposedHeaders)) {
          staticCorsHeaders['Access-Control-Expose-Headers'] =
            cors.exposedHeaders.join(',');
        }
      }

      if (cors.credentials) {
        staticCorsHeaders['Access-Control-Allow-Credentials'] = 'true';
      }
      if (cors.maxAge) {
        staticCorsHeaders['Access-Control-Max-Age'] = cors.maxAge;
      }
    }

    // undefined before load, null if loaded but there is none.
    let landingPage: LandingPage | null | undefined;

    // this has to be fn function handler
    fdk.handle(async (input: string | Buffer, context: Context) => {
      await this.ensureStarted();

      if (landingPage === undefined) {
        landingPage = this.getLandingPage();
      }

      const hctx = context.httpGateway;
      console.log(`handle ${hctx.method}`);
      const corsHeaders: Headers = { ...staticCorsHeaders };
      const originHeader = hctx.getHeader('origin');

      const handleResponse = ({ body, status = 200, headers = {} }: ResponseObject) => {
        // TODO check for body is error or unknown
        console.log(`handleResponse ${hctx.method} ${status}`)
        hctx.statusCode = status;
        headers = {
          ...headers,
          ...corsHeaders
        }
        console.log("headers", headers);
        for (const [key, value] of Object.entries(headers)) {
          hctx.setResponseHeader(key, value);
        }
        console.log(`returning response for ${hctx.method} ${status}`)
        console.log((body as any)?.length ?? 0)
        return body ?? undefined;
      }

      if (cors === undefined) {
        corsHeaders['Access-Control-Allow-Origin'] = '*';
      } else if (cors?.origin) {
        if (typeof cors.origin === 'string') {
          corsHeaders['Access-Control-Allow-Origin'] = cors.origin;
        } else if (
          typeof cors.origin === 'boolean' ||
          (Array.isArray(cors.origin) &&
            originHeader &&
            cors.origin.includes(originHeader))
        ) {
          corsHeaders['Access-Control-Allow-Origin'] = originHeader;
        }
      }

      if (
        !disableHealthCheck &&
        hctx.requestURL?.endsWith('/.well-known/apollo/server-health')
      ) {
        const successfulResponse = {
          body: JSON.stringify({ status: 'pass' }),
          status: 200,
          headers: {
            'Content-Type': 'application/health+json',
            ...corsHeaders,
          },
        };

        if (onHealthCheck) {
          try {
            await onHealthCheck(input);
            return handleResponse(successfulResponse);
          } catch {
            return handleResponse({
              body: JSON.stringify({ status: 'fail' }),
              status: 503,
              headers: {
                'Content-Type': 'application/health+json',
              },
            });
          }
        } else {
          return handleResponse(successfulResponse);
        }
      }

      if (hctx.method === 'OPTIONS') {
        if (
          hctx.getHeader('access-control-request-headers') &&
          (cors === undefined || (cors && !cors.allowedHeaders))
        ) {
          corsHeaders['Access-Control-Allow-Headers'] =
            hctx.getHeader('access-control-request-headers')
          corsHeaders['Vary'] = 'Access-Control-Request-Headers';
        }

        if (
          hctx.getHeader('access-control-request-method') &&
          (cors === undefined || (cors && !cors.methods))
        ) {
          corsHeaders['Access-Control-Allow-Methods'] =
          hctx.getHeader('access-control-request-method');
        }

        return handleResponse({
          body: '',
          status: 204
        });
      }

      if (
        landingPage &&
        hctx.method === 'GET' &&
        hctx.getHeader('accept')?.includes('text/html')
      ) {
        return handleResponse({
          body: landingPage.html,
          status: 200,
          headers: {
            'Content-Type': 'text/html',
          },
        });
      }

      const gqlFnFun = graphqlFnFunction(async () => {
        return this.createGraphQLServerOptions(input, hctx);
      }, this.csrfPreventionRequestHeaders)

      const response = await gqlFnFun(input, context);
      console.log("got response from gqlFnFun", response.body)
      return handleResponse(response);
    });
  }
}
