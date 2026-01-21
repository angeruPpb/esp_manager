import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EspModule } from './esp/esp.module';

@Module({
  imports: [EspModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}