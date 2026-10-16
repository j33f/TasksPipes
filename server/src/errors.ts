export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export const bad = (msg: string) => new HttpError(400, msg);
export const forbidden = (msg = "Action non autorisée") => new HttpError(403, msg);
export const notFound = (msg = "Introuvable") => new HttpError(404, msg);
