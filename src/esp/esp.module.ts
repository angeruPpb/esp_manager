import { Module, forwardRef } from '@nestjs/common';
import { EspService } from './esp.service';
import { EspController } from './esp.controller';
import { EspGateway } from './esp.gateway';
import { MqttModule } from '../mqtt/mqtt.module';

@Module({
  imports: [
    forwardRef(() => MqttModule),  // ✅ Usar forwardRef
  ],
  controllers: [EspController],
  providers: [EspService, EspGateway],
  exports: [EspService, EspGateway],
})
export class EspModule {}