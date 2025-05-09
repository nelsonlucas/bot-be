import { Module } from '@nestjs/common';
import { EventsGateway } from './events/events.gateway';
import { MongooseModule } from '@nestjs/mongoose';
import { EventsModule } from './events/events.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    MongooseModule.forRoot('mongodb://localhost:27017/nest'),
    ScheduleModule.forRoot(),
    EventsModule,
  ],
})
export class AppModule {}
