import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { Mongoose } from 'mongoose';
import { MongooseModule } from '@nestjs/mongoose';
import { Candle, CandleSchema } from './entities/candles';
import { CandlePattern } from './CandlePattern';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Candle.name, schema: CandleSchema }]),
  ],
  providers: [EventsGateway, CandlePattern, EventsService],
  controllers: [EventsController],
})
export class EventsModule {}
