import { Module } from '@nestjs/common';
import { EspModule } from './esp/esp.module';
import { MqttModule } from './mqtt/mqtt.module'; 

@Module({
  imports: [
    EspModule,
    MqttModule,
  ],
})
export class AppModule {}