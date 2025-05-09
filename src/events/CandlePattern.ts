import { Injectable } from '@nestjs/common';
import { Candle, Operation } from './entities/candles';

@Injectable()
export class CandlePattern {
  constructor() {}

  insideBar({
    beforeCandle,
    currentCandles,
  }: {
    beforeCandle: Candle;
    currentCandles: Candle;
  }): boolean {
    if (
      currentCandles.open <= beforeCandle.open &&
      currentCandles.close >= beforeCandle.close
    ) {
      return true;
    }
    return false;
  }
}
