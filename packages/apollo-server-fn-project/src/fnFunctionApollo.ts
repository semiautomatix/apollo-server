import type { Context } from '@fnproject/fdk';
import {
  GraphQLOptions,
  isHttpQueryError,
  runHttpQuery,
} from 'apollo-server-core';
import { Headers } from 'apollo-server-env';
import url from 'url';
import type { ResponseObject } from './ApolloServer';

// export interface AzureFunctionGraphQLOptionsFunction {
//   (request: HttpRequest, context: Context): ValueOrPromise<GraphQLOptions>;
// }

// export function graphqlAzureFunction(
//   options: GraphQLOptions | AzureFunctionGraphQLOptionsFunction,

export function graphqlFnFunction(
  options: GraphQLOptions | any, // TODO
  csrfPreventionRequestHeaders?: string[] | null,
): (input: string | Buffer, context: Context) => Promise<any> {
  if (!options) {
    throw new Error('Apollo Server requires options.');
  }

  const graphqlHandler: any = async (input: Record<string, any> | Record<string, any>[], context: Context): Promise<ResponseObject> => {
    const hctx = context.httpGateway;
    if (hctx.method === 'POST' && !input) {
      return {
        body: 'POST body missing.',
        status: 400,
        headers: {
          'Content-Type': 'text/html',
        },
      }
    }

    const requestURL = hctx.headers["Fn-Http-Request-Url"];
    const queryData: any = requestURL ? url.parse(requestURL[0], true).query : '';

    try {
      const { graphqlResponse, responseInit } = await runHttpQuery(
        [input, context],
        {
          method: hctx.method,
          options: options,
          query:
            hctx.method === 'POST' && input
              ? input
              : queryData,
          request: {
            url: hctx.requestURL,
            method: hctx.method,
            headers: new Headers(hctx.headers),
          },
        },
        csrfPreventionRequestHeaders,
      );
      const headers = responseInit.headers ?? {};
      return {
        body: graphqlResponse,
        status: 200,
        headers
      }
    } catch (error: unknown) {
      if (isHttpQueryError(error)) {
        const headers = error.headers ?? {};
        return {
          body: error.message,
          status: 200,
          headers
        }
      }
      return {
        body: error,
        status: 500
      }
    }
  };

  return graphqlHandler;
}
