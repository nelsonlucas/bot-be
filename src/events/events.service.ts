import { Injectable, Logger } from '@nestjs/common';
import { CandlePattern } from './CandlePattern';
import * as tf from '@tensorflow/tfjs';
import { Candle, CandleDocument, Operation } from './entities/candles';
import { binanceApi } from 'src/apis/binance';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {EMA} from 'trading-signals';
import yahooFinance from 'yahoo-finance2';
import axios from 'axios';

tf.disableDeprecationWarnings();

export type Market = {
  adjClose: number;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
export type Signal= {
  operation : 'BUY'|'SELL';
  price: number;
}
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
    await tf.setBackend('cpu');

    if (indexCurrentCandle <= 1 || indexCurrentCandle >= candles.length - 1) {
      return { close: candle.close, predictClose: candle.close };
    }

    const inputs = candles
      .slice(0, indexCurrentCandle - 1)
      .map((c, index, array) => {
        const prevCandle = array[index - 1] || c;
        const range = c.high - c.low;
        const body = Number(Math.abs(c.close - c.open).toFixed(2));
        const isBullish = c.close > c.open;

        const weightBody = range === 0 ? 0 : Number((body / range).toFixed(2));
        const isInsideBar = c.high < prevCandle.high && c.low > prevCandle.low;
        const isOutsideBar = c.high > prevCandle.high && c.low < prevCandle.close;
        const hasGapBulish = c.open > prevCandle.close;
        const hasGapBearish = c.open < prevCandle.close;

        return [
          Number(c.open.toFixed(2)),
          Number(c.high.toFixed(2)),
          Number(c.low.toFixed(2)),
          Number(c.close.toFixed(2)),
          weightBody,
          isBullish ? 1 : 0,
          isInsideBar ? 1 : 0,
          isOutsideBar ? 1 : 0,
          hasGapBulish ? 1 : 0,
          hasGapBearish ? 1 : 0,
        ];
      });

    // Corrigido: prever o fechamento do próximo candle
    const labels = candles
      .slice(1, indexCurrentCandle)
      .map((c) => [Number(c.close.toFixed(2)), c.close > c.open ? 1 : 0]);

    const inputTensor = tf.tensor2d(inputs);
    const labelTensor = tf.tensor2d(labels);

    const model = tf.sequential();
    const inputSize = inputs[0].length;

    model.add(
      tf.layers.dense({
        inputShape: [inputSize],
        units: 64,
        activation: 'relu',
      }),
    );
    model.add(tf.layers.dense({ units: 128, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
    model.add(tf.layers.dense({ units: labels[0].length }));

    model.compile({ optimizer: 'adam', loss: 'meanSquaredError' });

    await model.fit(inputTensor, labelTensor, { epochs: 100, verbose: 0 });

    // Previsão usando o candle atual
    const c = candles[indexCurrentCandle];
    const prevCandle = candles[indexCurrentCandle - 1];

    const range = c.high - c.low;
    const body = Number(Math.abs(c.close - c.open).toFixed(2));
    const isBullish = c.close > c.open;
    const weightBody = range === 0 ? 0 : Number((body / range).toFixed(2));
    const isInsideBar = c.high < prevCandle.high && c.low > prevCandle.low;
    const isOutsideBar = c.high > prevCandle.high && c.low < prevCandle.close;
    const hasGapBulish = c.open > prevCandle.close;
    const hasGapBearish = c.open < prevCandle.close;

    const prediction = model.predict(
      tf.tensor2d([
        [
          Number(c.open.toFixed(2)),
          Number(c.high.toFixed(2)),
          Number(c.low.toFixed(2)),
          Number(c.close.toFixed(2)),
          weightBody,
          isBullish ? 1 : 0,
          isInsideBar ? 1 : 0,
          isOutsideBar ? 1 : 0,
          hasGapBulish ? 1 : 0,
          hasGapBearish ? 1 : 0,
        ],
      ]),
    ) as tf.Tensor;

    const predictValues: any = await prediction.array();

    return {
      predictClose: predictValues?.[0]?.[0] || 0,
      predictOperation: predictValues?.[0]?.[1] >= 0.5 ? 'BUY' : 'SELL',
    };
  }

  async getDataStock({
    symbol,
    period1,
    period2,
  }: {
    symbol?: string;
    period1?: string;
    period2?: string;
  }): Promise<Market[]> {
    try {
      const data = await yahooFinance.historical(symbol, {
        period1,
        period2,
      });
      return data as unknown as Market[];
    } catch (error) {
      this.logger.error(error);
    }
  }

  async syncMarketBinance({
    symbol,
    interval,
    startTime,
    endTime,
  }: {
    symbol?: string;
    interval?: string;
    startTime?: number;
    endTime?: number;
  }) {
    const { data: market } = await binanceApi.get(`v3/klines`, {
      params: {
        symbol,
        interval,
        startTime,
        endTime,
      },
    });
    return market;
  }

  async executeBackTest({ lote, typeOperation, price, currentOperation }) {
    // verifica se tem operacao em aberto e ela é identica a operacao atual
    if (currentOperation.operationType === typeOperation) {
      // calculo do lucro que oscila, ou seja, enquanto a ordem estiver aberta
      const floatProfit = +(
        (price - currentOperation.openPrice) *
        currentOperation.lote
      ).toFixed(2);

      return { ...currentOperation, floatProfit };
    }

    let objCurrentOperation = {} as any;
    if (
      (Object.keys(currentOperation).length === 0 ||
        currentOperation?.status === 'CLOSE') &&
      typeOperation === 'BUY'
    ) {
      // definir como compra
      objCurrentOperation.operationType = typeOperation;
      objCurrentOperation.openPrice = price;
      objCurrentOperation.lote = lote;
      objCurrentOperation.status = 'OPEN';
      objCurrentOperation.totalOperation = Number(price * lote);
    } else if (
      (Object.keys(currentOperation).length === 0 ||
        currentOperation?.status === 'CLOSE') &&
      typeOperation === 'SELL'
    ) {
      // definir como venda
      objCurrentOperation.operationType = typeOperation;
      objCurrentOperation.openPrice = price;
      objCurrentOperation.lote = lote;
      objCurrentOperation.status = 'OPEN';
      objCurrentOperation.totalOperation = Number(price * lote);
    } else if (
      currentOperation?.status === 'OPEN' &&
      typeOperation === 'SELL'
    ) {
      // calculo lucro
      const profit = +(
        (price - currentOperation.openPrice) *
        currentOperation.lote
      ).toFixed(2);

      // fechar operacao
      objCurrentOperation.status = 'CLOSE';
      objCurrentOperation.profit = profit;
    }

    // verificar se a operacao atual é venda
    return objCurrentOperation;
  }

  async executeBackTest2({
    date,
    lote,
    typeOperation,
    price,
    currentOperation,
  }) {
    // Operação em aberto e do mesmo tipo: apenas lucro flutuante
    if (
      currentOperation.status === 'OPEN' &&
      currentOperation.operationType === typeOperation
    ) {
      const floatProfit = +(
        (typeOperation === 'BUY'
          ? price - currentOperation.openPrice
          : currentOperation.openPrice - price) * currentOperation.lote
      ).toFixed(2);

      return { ...currentOperation, profit: floatProfit };
    }

    // Abrir nova operação se nenhuma está aberta
    if (!currentOperation.status || currentOperation.status === 'CLOSE') {
      return {
        operationType: typeOperation,
        openPrice: price,
        lote,
        status: 'OPEN',
        totalOperation: +(price * lote).toFixed(2),
        date,
      };
    }

    // Fechar operação existente
    if (
      currentOperation.status === 'OPEN' &&
      currentOperation.operationType !== typeOperation
    ) {
      const profit = +(
        (currentOperation.operationType === 'BUY'
          ? price - currentOperation.openPrice
          : currentOperation.openPrice - price) * currentOperation.lote
      ).toFixed(2);
      // const profit = +((price - currentOperation.openPrice) * currentOperation.lote).toFixed(2);

      return {
        ...currentOperation,
        status: 'CLOSE',
        closePrice: price,
        profit,
      };
    }

    // Caso nenhuma das condições seja atendida, retorne a operação atual
    return currentOperation;
  }
}
