import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { SalesModule } from '../sales/sales.module';

@Module({
  imports: [SalesModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
