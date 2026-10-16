/** Parameters of a message: "{name}" placeholders, translated when they are known words (see i18n.ts). */
export type Params = Record<string, string | number>;

/** An error sent to the client; its message is English source text, translated per request. */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public params?: Params
  ) {
    super(message);
  }
}

export const bad = (msg: string, params?: Params) => new HttpError(400, msg, params);
export const forbidden = (msg = "Action not allowed", params?: Params) => new HttpError(403, msg, params);
export const notFound = (msg = "Not found", params?: Params) => new HttpError(404, msg, params);
