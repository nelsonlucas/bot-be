import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { Mongoose } from 'mongoose';
import { MongooseModule } from '@nestjs/mongoose';
import { Candle, CandleSchema } from './entities/candles';
import { CandlePattern } from './CandlePattern';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { Predict, PredictSchema } from './entities/predict';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Candle.name, schema: CandleSchema },
      { name: Predict.name, schema: PredictSchema },
    ]),
  ],
  providers: [EventsGateway, CandlePattern, EventsService],
  controllers: [EventsController],
})
export class EventsModule {}
