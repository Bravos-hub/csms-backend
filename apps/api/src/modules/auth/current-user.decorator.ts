import { createParamDecorator, ExecutionContext } from '@nestjs/common';

type RequestWithUser = {
  user?: unknown;
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    return request.user;
  },
);
