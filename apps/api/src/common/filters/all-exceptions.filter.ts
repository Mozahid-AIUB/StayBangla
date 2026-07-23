import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";

interface MinimalResponse {
  status(code: number): { json(body: unknown): void };
}

interface MinimalRequest {
  method: string;
  url: string;
}

interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  timestamp: string;
  path: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<MinimalResponse>();
    const request = ctx.getRequest<MinimalRequest>();

    const { statusCode, error, message } = this.resolve(exception);

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${statusCode}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const body: ErrorResponseBody = {
      statusCode,
      error,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(statusCode).json(body);
  }

  private resolve(exception: unknown): { statusCode: number; error: string; message: string | string[] } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === "string") {
        return { statusCode: status, error: exception.name, message: res };
      }

      const resObj = res as { message?: string | string[]; error?: string };
      return {
        statusCode: status,
        error: resObj.error ?? exception.name,
        message: resObj.message ?? exception.message,
      };
    }

    // Never leak internal error details (stack traces, connection strings, etc.)
    // to the client for unhandled exceptions — only the generic message below.
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: "Internal Server Error",
      message: "An unexpected error occurred",
    };
  }
}
