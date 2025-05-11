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

    // index 0 é o mesmo preco de mercado
    if (indexCurrentCandle <= 1) {
      return { close: candle.close, predictClose: candle.close };
    }

    // Convert candles to inputs and labels

    const inputs = candles
      .slice(0, indexCurrentCandle - 1)
      .map((c, index, array) => {
        // candle anterior
        const prevCandle = array[index - 1] || c;

        // parametros padroes
        const range = c.high - c.low;
        const body = Number(Math.abs(c.close - c.open).toFixed(2));
        const isBullish = c.close > c.open;

        // parametros al brooks
        const weightBody = range === 0 ? 0 : Number((body / range).toFixed(2)); // forca do corpo
        const isInsideBar = c.high < prevCandle.high && c.low > prevCandle.low; // é insideBar
        const isOutsideBar =
          c.high > prevCandle.high && c.low < prevCandle.close; // é outsideBar
        const hasGapBulish = c.open > prevCandle.close; // tem gap de corpo de alta
        const hasGapBearish = c.open < prevCandle.close; // tem gap de corpo de baixa
        // const ema = +(ema20.getResult()?.toFixed(2));

        return [
          Number(c.open.toFixed(2)),
          Number(c.high.toFixed(2)),
          Number(c.low.toFixed(2)),
          Number(c.close.toFixed(2)),
          weightBody,
          isBullish ? 1 : 0,
          // body,
          isInsideBar ? 1 : 0,
          isOutsideBar ? 1 : 0,
          hasGapBulish ? 1 : 0,
          hasGapBearish ? 1 : 0,
          // ema
        ];
      }); // previsão

    // const labels = candles
    //   .slice(0, indexCurrentCandle - 1)
    //   .map((c) => {
    //     const isBullish = c.close > c.open;
    //     return [
    //       c.close,
    //       isBullish ? 1 : -1,
    //     ]});
    const labels = inputs.map((c: any) => [c?.[3], c?.[5]]);

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
    const weightBody = range === 0 ? 0 : Number((body / range).toFixed(2)); // forca do corpo
    const isInsideBar = c.high < prevCandle.high && c.low > prevCandle.low; // é insideBar
    const isOutsideBar = c.high > prevCandle.high && c.low < prevCandle.close; // é outsideBar
    const hasGapBulish = c.open > prevCandle.close; // tem gap de corpo de alta
    const hasGapBearish = c.open < prevCandle.close; // tem gap de corpo de baixa

    const nextPrediction = model.predict(
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

    // (nextPrediction as tf.Tensor).print();

    const predictValues: any = await nextPrediction.array();

    return {
      predictClose: predictValues?.[0]?.[0] || 0,
      predictOperation: predictValues?.[0]?.[1] > 1 ? 'BUY' : 'SELL',
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
    timeframe,
  }: {
    symbol?: string;
    timeframe?: string;
  }) {
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

  async executeBackTest2({ lote, typeOperation, price, currentOperation }) {
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
      };
    }

    // Fechar operação existente
    if (
      currentOperation.status === 'OPEN' &&
      currentOperation.operationType !== typeOperation
    ) {
      const profit = +(
        (currentOperation.operationType === 'SELL'
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

  async processar() {
    const listAtivos = [
      // 'ALOS3',
      // 'ABEV3',
      // 'ASAI3',
      // 'AURE3',
      'AZUL4',
      'AZZA3',
      'B3SA3',
      'BBSE3',
      'BBDC3',
      'BBDC4',
      'BRAP4',
      'BBAS3',
      'BRKM5',
      'BRAV3',
      'BRFS3',
      'BPAC11',
      'CXSE3',
      'CRFB3',
      'CMIG4',
      'COGN3',
      'CPLE6',
      'CSAN3',
      'CPFE3',
      'CMIN3',
      'CVCB3',
      'CYRE3',
      'DIRR3',
      'ELET3',
      'ELET6',
      'EMBR3',
      'ENGI11',
      'ENEV3',
      'EGIE3',
      'EQTL3',
      'FLRY3',
      'GGBR4',
      'GOAU4',
      'NTCO3',
      'HAPV3',
      'HYPE3',
      'IGTI11',
      'IRBR3',
      'ISAE4',
      'ITSA4',
      'ITUB4',
      'JBSS3',
      'KLBN11',
      'RENT3',
      'LREN3',
      'MGLU3',
      'POMO4',
      'MRFG3',
      'BEEF3',
      'MOTV3',
      'MRVE3',
      'MULT3',
      'PCAR3',
      'PETR3',
      'PETR4',
      'RECV3',
      'PRIO3',
      'PETZ3',
      'PSSA3',
      'RADL3',
      'RAIZ4',
      'RDOR3',
      'RAIL3',
      'SBSP3',
      'SANB11',
      'STBP3',
      'SMTO3',
      'CSNA3',
      'SLCE3',
      'SMFT3',
      'SUZB3',
      'TAEE11',
      'VIVT3',
      'TIMS3',
      'TOTS3',
      'UGPA3',
      'USIM5',
      'VALE3',
      'VAMO3',
      'VBBR3',
      'VIVA3',
      'WEGE3',
    ];

    // for (const ativo of listAtivos) {

    //   const candles = await this.getDataStock({
    //     symbol: `${ativo}.SA`,
    //     period1: '2025-01-02',
    //     period2:  "2025-05-10",
    //   });
  
    //   for (const candle of candles || []) {
    //     await this.candleModel.findOneAndUpdate(
    //       {
    //        symbol: ativo,
    //        timeframe: `D`,
    //        date: candle.date,
    //       },
    //       {
    //         open: candle.open,
    //         high: candle.high,
    //         low: candle.low,
    //         close: candle.close,
    //         volume: candle.volume,
    //       },
    //       {
    //         upsert: true,
    //         new: true,
    //       },
    //     );
    //   }
      
    // }
    // this.logger.verbose('FIM');

    for (const ativo of listAtivos) {
      const symbol= `${ativo}`;
      this.logger.verbose(`Iniciando o processamento de predicao para o ativo ${symbol}`);
      await axios.post(`https://cfe6-177-39-126-184.ngrok-free.app/events/predict`,{
        symbol
      });
      this.logger.verbose(`Processamento finalizado`);
    }
    this.logger.verbose('FIM DO PROCESSAMENTO GLOBAL');
  }
}
