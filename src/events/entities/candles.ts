import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CandleDocument = HydratedDocument<Candle>;
@Schema({ timestamps: true })
export class Candle {
  @Prop()
  symbol: string;
  @Prop()
  interval: string;
  @Prop()
  date: Date;
  @Prop()
  open: number;
  @Prop()
  high: number;
  @Prop()
  low: number;
  @Prop()
  close: number;
  @Prop()
  volume: number;
}

export class Operation {
  @Prop()
  operation: number;
}

export const CandleSchema = SchemaFactory.createForClass(Candle);
