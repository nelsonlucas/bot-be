import { Injectable, Logger } from '@nestjs/common';
import { CandlePattern } from './CandlePattern';
import * as tf from '@tensorflow/tfjs';
import { Candle, CandleDocument, Operation } from './entities/candles';
import { binanceApi } from 'src/apis/binance';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
tf.disableDeprecationWarnings();
tf.setBackend('cpu');

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  constructor(
    private readonly candlePattern: CandlePattern,
    @InjectModel(Candle.name)
    private candleModel: Model<CandleDocument>,
  ) {}

  async predict({
    candle,
    candles,
    indexCurrentCandle = 0,
  }: {
    candle: Candle;
    candles: Array<Candle>;
    indexCurrentCandle: number;
  }) {
    // index 0 é o mesmo preco de mercado
    if (indexCurrentCandle <= 1) {
      return { close: candle.close, predictClose: candle.close };
    }

    // Convert candles to inputs and labels
    const inputs = candles.slice(0, indexCurrentCandle - 1).map((c,index,array) => {

      // candle anterior
      const prevCandle = array[index - 1] || c;

      // parametros padroes
      const range = c.high - c.low;
      const body = Number(Math.abs(c.close - c.open).toFixed(2));
      const isBullish = c.close > c.open;

      // parametros al brooks
      const weightBody = Number((body / range).toFixed(2));  // forca do corpo
      const isInsideBar = c.high < prevCandle.high && c.low > prevCandle.low; // é insideBar
      const isOutsideBar = c.high > prevCandle.high && c.low < prevCandle.close;;       // é outsideBar
      const hasGapBulish = c.open > prevCandle.close;       // tem gap de corpo de alta
      const hasGapBearish = c.open < prevCandle.close;      // tem gap de corpo de baixa

      return [
        c.open, 
        c.high, 
        c.low, 
        c.close,
        c.volume,
        weightBody,
        isBullish ? 1 : -1, 
        body,
        isInsideBar ? 1 : -1,
        isOutsideBar ? 1 : -1,
        hasGapBulish ? 1 : -1,
        hasGapBearish ? 1 : -1
      ];
    }); // previsão

    const labels = candles
      .slice(0, indexCurrentCandle - 1)
      .map((c) => {
        const isBullish = c.close > c.open;
        return [
          c.open, 
          c.close,
          isBullish ? 1 : -1,
        ]});

    const inputTensor = tf.tensor2d(inputs);
    const labelTensor = tf.tensor2d(labels);

    // Criando o modelo
    const model = tf.sequential();

    const inputSize = inputs[0].length;

    model.add(
      tf.layers.dense({
        inputShape: [inputSize],
        units: 64,
        activation: 'relu',
      }),
    );
    model.add(
      tf.layers.dense({
        units: 128,
        activation: 'relu',
      }),
    );

    // model.add(tf.layers.batchNormalization());
    // model.add(tf.layers.dropout({ rate: 0.3 }));

    model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
    model.add(tf.layers.dense({ units: labels[0].length }));

    model.compile({ optimizer: 'adam', loss: 'meanSquaredError' });

    // Treina o modelo
    await model.fit(inputTensor, labelTensor, {
      epochs: 100,
      verbose: 0,
    });

    // Fazendo uma previsão
    const c = candles[indexCurrentCandle];
    const prevCandle = candles[indexCurrentCandle - 1];

    // parametros padroes
    // parametros padroes
    const range = c.high - c.low;
    const body = Number(Math.abs(c.close - c.open).toFixed(2));
    const isBullish = c.close > c.open;

    // parametros al brooks
    const weightBody = Number((body / range).toFixed(2));  // forca do corpo
    const isInsideBar = c.high < prevCandle.high && c.low > prevCandle.low; // é insideBar
    const isOutsideBar = c.high > prevCandle.high && c.low < prevCandle.close;;       // é outsideBar
    const hasGapBulish = c.open > prevCandle.close;       // tem gap de corpo de alta
    const hasGapBearish = c.open < prevCandle.close;      // tem gap de corpo de baixa


    const nextPrediction = model.predict(
      tf.tensor2d([
        [
          c.open,
          c.high,
          c.low,
          c.close,
          c.volume,
          weightBody,
          isBullish ? 1 : -1, 
          body,
          isInsideBar ? 1 : -1,
          isOutsideBar ? 1 : -1,
          hasGapBulish ? 1 : -1,
          hasGapBearish ? 1 : -1
        ],
      ]),
    ) as tf.Tensor;

    // (nextPrediction as tf.Tensor).print();

    const predictValues: any = await nextPrediction.array();

    return {
      predictOpen: predictValues?.[0]?.[0],
      predictClose: predictValues?.[0]?.[1],
      predictOperation: predictValues?.[0]?.[2] > 1 ? 'BUY' : 'SELL',
    };
  }

  async syncMarketBinance({ symbol,timeframe }: { symbol?: string,timeframe?: string }) {
    let allSymbol = [symbol];
    if (!symbol) {
      const { data } = await binanceApi.get(`v3/exchangeInfo`);
      allSymbol = data.symbols.map((item) => item.symbol);
    }
    const interval = timeframe ?? '1h';
    for (const symbol of allSymbol || []) {
      const { data: market } = await binanceApi.get(
        `v3/klines?symbol=${symbol}&interval=${interval}&limit=999`,
      );

      const allPromises = market.map((item) =>
        this.candleModel.findOneAndUpdate(
          {
            symbol,
            timeframe: interval,
            openTime: new Date(item[0]),
          },
          {
            timeframe: interval,
            openTime: new Date(item[0]),
            open: item[1],
            high: item[2],
            low: item[3],
            close: item[4],
            volume: item[5],
            closeTime: new Date(item[6]),
            quoteAssetsVolume: item[7],
            numberOfTrades: item[8],
            takerBuyBaseVolume: item[9],
            takerBuyQuoteVolume: item[10],
            takerBuyQuoteAssetVolume: item[7],
            ignore: item[11],
          },
          {
            upsert: true,
            new: true,
          },
        ),
      );

      await Promise.all(allPromises);
    }
  }
}
