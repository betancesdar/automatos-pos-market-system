import { Module } from '@nestjs/common';
import { AuthController, UsersController } from './users.controller';
import { AuthService, UsersService } from './users.service';

@Module({
  controllers: [AuthController, UsersController],
  providers: [AuthService, UsersService],
  exports: [AuthService, UsersService],
})
export class UsersModule {}
