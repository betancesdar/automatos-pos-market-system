import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Res,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { AuthService, UsersService } from './users.service';
import { Role } from '@prisma/client';
import { Public, JwtAuthGuard } from '../../common/auth.guard';
import { COOKIE_NAMES } from '../../common/jwt.util';

class LoginDto {
  identifier: string;
  password: string;
}

class CreateUserDto {
  name: string;
  username: string;
  email?: string;
  password: string;
  role: Role;
}

class UpdateUserDto {
  name?: string;
  username?: string;
  email?: string | null;
  password?: string;
  role?: Role;
}

function cookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict' as const,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { user, token } = await this.authService.login(body.identifier, body.password);

    res.cookie(COOKIE_NAMES.accessToken, token, cookieOptions());
    if (user.tenantId) {
      res.cookie(COOKIE_NAMES.tenantId, user.tenantId, cookieOptions());
    }

    return { user, token };
  }

  @Public()
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(COOKIE_NAMES.accessToken, { path: '/' });
    res.clearCookie(COOKIE_NAMES.tenantId, { path: '/' });
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() req: Request & { user: { sub: string } }) {
    return this.authService.getMe(req.user.sub);
  }
}

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  listUsers(@Query('tenantId') tenantId: string) {
    return this.usersService.listUsers(tenantId);
  }

  @Post()
  createUser(@Query('tenantId') tenantId: string, @Body() body: CreateUserDto) {
    return this.usersService.createUser(tenantId, body);
  }

  @Put(':id')
  updateUser(
    @Query('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() body: UpdateUserDto,
  ) {
    return this.usersService.updateUser(tenantId, id, body);
  }

  @Delete(':id')
  deleteUser(@Query('tenantId') tenantId: string, @Param('id') id: string) {
    return this.usersService.deleteUser(tenantId, id);
  }
}
