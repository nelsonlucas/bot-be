import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CandleDocument = HydratedDocument<Candle>;
@Schema({ timestamps: true })
export class Candle {
  @Prop()
  symbol: string;
  @Prop()
  timeframe: string;
  @Prop()
  openTime: Date;
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
  @Prop()
  closeTime: Date;
  @Prop()
  quoteAssetsVolume: string;
  @Prop()
  numberOfTrades: number;
  @Prop()
  takerBuyBaseVolume: number;
  @Prop()
  takerBuyQuoteVolume: number;
  @Prop()
  ignore: string;
}

export class Operation {
  @Prop()
  operation: number;
}

export const CandleSchema = SchemaFactory.createForClass(Candle);
