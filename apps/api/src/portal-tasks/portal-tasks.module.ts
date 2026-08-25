import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PortalTasksController } from './portal-tasks.controller';
import { PortalTasksService } from './portal-tasks.service';

@Module({
  imports: [AuthModule],
  controllers: [PortalTasksController],
  providers: [PortalTasksService],
  exports: [PortalTasksService],
})
export class PortalTasksModule {}
