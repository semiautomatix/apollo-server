declare module "@fnproject/fdk" {
  import type { Response } from "node-fetch";

  export function handle(fnfunction: fnHandler, options?: object): () => void;
  export function streamResult(stream: any): StreamResult;
  export function rawResult(res: string | Buffer): RawResult;
  /**
   * The function handler  - This is a user-supplied node function that implements the behaviour of the current fn function
   */
  export type fnHandler = (body: string | Buffer, context: Context) => string | number | Promise<any> | null | Response;

  /**
   * Context is the function invocation context - it enables functions to read and write metadata from the request including event headers, config and the underlying payload
   */
  export class Context {
    constructor(config: any, payload: any, headers: any);
    _config: any;
    _body: any;
    _headers: any;
    _responseHeaders: {};
    /**
     * Returns the deadline for the function invocation as a Date object
     * @returns {Date}
     */
    get deadline(): Date;
    /**
     * returns the Fn Call ID associated with this call
     * @returns {string}
     */
    get callID(): string;
    /**
     * Returns the application name associated with this function
     * @returns {string}
     */
    get appName(): string;
    /**
     * Returns the application ID associated with this function
     * @returns {string}
     */
    get appID(): string;
    /**
     * Returns the function name associated with this function
     * @returns {string}
     */
    get fnName(): string;
    /**
     * Returns the function ID associated with this function
     * @returns {string}
     */
    get fnID(): string;
    /**
     * Returns the amount of RAM (in MB) allocated to this function
     * @returns {number}
     */
    get memory(): number;
    /**
     * Returns the application configuration for this function
     * @returns {Object.<string,string>}
     */
    get config(): {
      [x: string]: string;
    };
    /**
     * Returns the raw body of the input to this function
     * @returns {*}
     */
    get body(): any;
    /**
     * Returns the content type of the body (if set)
     * @returns {null|string}
     */
    get contentType(): string;
    /**
     * returns a map of headers associated with this function this is an object containing key->[string] values
     * Header keys are always canonicalized to HTTP first-caps style

     * This returns a copy of the underlying headers, changes to the response value will not be reflected in the function response
     *
     * @returns {Object.<string,Array.<string>>}
     */
    get headers(): {
      [x: string]: string[];
    };
    /**
     * Create an OCI APM TracingContext for the current invocation.
     */
    get tracingContext(): TracingContext;
    /**
     * returns a object containing the outbound  headers  associated with this function this is an object containing key->[string] values
     *
     * Header keys are always canonicalized to HTTP first-caps style
     *
     * This returns a copy of the underlying headers, changes to the response value will not be reflected in the function response
     *
     * @returns {Object.<string,Array.<string>>}
     */
    get responseHeaders(): {
      [x: string]: string[];
    };
    /**
     * returns all header values for a given key
     * @param key {string}
     * @returns {Array.<string>}
     */
    getAllHeaderValues(key: string): Array<string>;
    /**
     * Returns the first value of a given header or null
     * Header keys are compared using case-insensitive matching
     * @param key {string}
     * @returns {string|null}
     */
    getHeader(key: string): string | null;
    /**
     * Returns a config value for a given key
     * @param key  {string}
     * @returns {string|null}
     */
    getConfig(key: string): string | null;
    /**
     * Returns the first value of a given header or null
     * Header keys are compared using case-insensitive matching
     * @param key {string}
     * @returns {string|null}
     */
    getResponseHeader(key: string): string | null;
    /**
     * Sets a response header to zero or more values
     * @param key {string}
     * @param values {string}
     */
    setResponseHeader(key: string, ...values: string[]): void;
    /**
     * Appends a response header to any existing values
     * @param key {string}
     * @param values {string}
     */
    addResponseHeader(key: string, ...values: string[]): void;
    /**
     * Sets the response content type
     * @param contentType {string}
     */
    set responseContentType(arg: string);
    /**
     * Gets the response content type
     * @returns {string|null}
     */
    get responseContentType(): string;
    /**
     * Returns the httpContext associated with this request
     * @returns {HTTPGatewayContext}
     */
    get httpGateway(): HTTPGatewayContext;
  }

  export class HTTPGatewayContext {
    /**
     * Create an HTTP context
     * @param ctx {Context}
     */
    constructor(ctx: Context);
    ctx: Context;
    _headers: {};
    /**
     * returns the HTTP request URL for this event
     * @returns {string}
     */
    get requestURL(): string;
    /**
     * Returns the HTTP method for this event
     * @returns {string}
     */
    get method(): string;
    /**
     * returns the HTTP headers received by the gateway for this event
     * @returns {*}
     */
    get headers(): any;
    /**
     * Retuns a specific header or null if the header is not set - where multiple  values are present the first header is returned
     * @param key {string} the header key
     * @returns {string|null}
     */
    getHeader(key: string): string | null;
    /**
     * returns all header values for a given key
     * @param key {string}
     * @returns {Array.<string>}
     */
    getAllHeaderValues(key: string): Array<string>;
    /**
     * set the status code of the HTTP response
     * @param status {number}
     */
    set statusCode(arg: number);
    /**
     * Sets a response header to zero or more values
     * @param key {string}
     * @param values {string}
     */
    setResponseHeader(key: string, ...values: string[]): void;
    /**
     * Appends a response header to any existing values
     * @param key {string}
     * @param values {string}
     */
    addResponseHeader(key: string, ...values: string[]): void;
  }
}

declare class StreamResult extends FnResult {
  constructor(stream: any);
  _stream: any;
  writeResult(ctx: any, resp: any): any;
}
declare class RawResult extends FnResult {
  constructor(raw: any);
  _raw: any;
}

/**
 * A function result = this causes the handler wrapper to use a specific response writer
 */
declare class FnResult {
  writeResult(ctx: any, resp: any): void;
}
/**
 * TracingContext defines an OCI APM tracing context for the current invocation.
 * Traces are currently defined by the Zipkin standard.
 * See: https://zipkin.io/pages/instrumenting
 */
declare class TracingContext {
  constructor(ctx: any);
  isEnabled: boolean;
  traceCollectorUrl: any;
  traceId: any;
  spanId: any;
  parentSpanId: any;
  sampled: boolean;
  flags: any;
  serviceName: string;
}

