import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { AccessRevocationReadService } from './access-revocation-read.service';
import { AccessRevocationService } from './access-revocation.service';
import { OffboardingChecklistController } from './offboarding-checklist.controller';
import { OffboardingChecklistService } from './offboarding-checklist.service';
import { OffboardingExportService } from './offboarding-export.service';

@Module({
  imports: [AuthModule, AttachmentsModule],
  controllers: [OffboardingChecklistController],
  providers: [
    OffboardingChecklistService,
    AccessRevocationService,
    AccessRevocationReadService,
    OffboardingExportService,
  ],
  exports: [OffboardingChecklistService],
})
export class OffboardingChecklistModule {}
