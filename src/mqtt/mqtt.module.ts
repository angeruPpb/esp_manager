import { Module, forwardRef  } from '@nestjs/common';
import { MqttService } from './mqtt.service';
import { EspModule } from '../esp/esp.module';
import { EspService } from '../esp/esp.service';
import { EspGateway } from '../esp/esp.gateway';

@Module({
  imports: [forwardRef(() => EspModule),],
  providers: [MqttService, EspService, EspGateway],
  exports: [MqttService],
})
export class MqttModule {}