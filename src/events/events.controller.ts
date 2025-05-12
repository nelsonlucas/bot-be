import { Controller, Get, Logger, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { EventsService, Signal } from './events.service';
import { InjectModel } from '@nestjs/mongoose';
import { Candle, CandleDocument } from './entities/candles';
import { Model } from 'mongoose';
import { writeFileSync } from 'fs';
import * as daysjs from 'dayjs';
import { unparse } from 'papaparse';
import * as _ from 'lodash';
import { Predict, PredictDocument } from './entities/predict';

@Controller('events')
export class EventsController {
  private readonly logger = new Logger(EventsController.name);
  constructor(
    private readonly eventsService: EventsService,
    @InjectModel(Candle.name)
    private candleModel: Model<CandleDocument>,
    @InjectModel(Predict.name)
    private predictModel: Model<PredictDocument>,
  ) {}

  @Post('executePredict')
  async executePredict(@Req() req: Request, @Res() res: Response) {
    const { symbol, startDate, endDate, interval } = req?.body;

    let candles = [];
    let executeLoop = true;
    do {
      candles = await this.candleModel
        .find({
          symbol,
          date: { $gte: new Date(startDate), $lte: new Date(endDate) },
        })
        .sort({ date: 1 })
        .lean();

      // verificar se o ativo é B3 ou Crypto
      const isB3 = /\d/gm.test(symbol);

      // buscar binance
      if (!isB3 && candles.length === 0) {
        const market = await this.eventsService.syncMarketBinance({
          symbol,
          ...(interval ? { interval } : { interval: '1d' }),
          startTime: new Date(startDate).getTime(),
          endTime: new Date(endDate).getTime(),
        });

        const allPromises = market.map((item) =>
          this.candleModel.findOneAndUpdate(
            {
              symbol,
              interval,
              date: new Date(item[0]),
            },
            {
              interval,
              date: new Date(item[0]),
              open: item[1],
              high: item[2],
              low: item[3],
              close: item[4],
              volume: item[5],
            },
            {
              upsert: true,
              new: true,
            },
          ),
        );

        await Promise.all(allPromises);
        executeLoop = false;
      } else if (isB3 && candles.length === 0) {
        let market: any = await this.eventsService.getDataStock({
          symbol,
          period1: startDate,
          period2: endDate,
        });

        const allPromises = (market || []).map((item) =>
          this.candleModel.findOneAndUpdate(
            {
              symbol,
              ...(interval ? { interval } : { interval: '1d' }),
              date: item.date,
            },
            {
              open: item.open,
              high: item.high,
              low: item.low,
              close: item.close,
              volume: item.volume,
            },
            {
              upsert: true,
              new: true,
            },
          ),
        );

        await Promise.all(allPromises);
        executeLoop = false;
      } else {
        executeLoop = false;
      }
    } while (executeLoop);

    let body = [];
    for (const [index, candle] of candles.entries()) {
      // realiza a predicao dos precos de fechamento
      const predict: any = await this.eventsService.predict({
        indexCurrentCandle: index,
        candle,
        candles,
      });

      const predictClose = predict?.predictClose ?? 0;
      const operation = predict?.predictOperation;

      body.push({
        symbol,
        date: candle?.date,
        open: candle.open,
        close: candle.close,
        predictClose,
        operation,
      });
    }

    const mean = _.mean(body.map((item) => item.close));
    const std = Math.sqrt(_.mean(body.map((x) => (x.close - mean) ** 2)));

    const zLimit = 2;
    body = body.filter((x) => Math.abs((x.close - mean) / std) <= zLimit);

    // zerar as predicoes daquele ativo e salvar os novos resultado
    await this.predictModel.deleteMany({ symbol });
    body.map(
      async (item) =>
        await this.predictModel.findOneAndUpdate(
          {
            symbol: item.symbol,
            date: {$eq: new Date(item?.date)},
          },
          {
            open: item.open,
            close: item.close,
            predictClose: item?.predictClose,
            operation: item?.operation,
          },
          {
            upsert: true,
            new: true,
          },
        ),
    );

    return res.json({
      success: true,
      msg: 'Predictions saved',
    });
  }

  @Get('executeBackTest')
  async executeBackTest(@Req() req: Request, @Res() res: Response) {
    const { symbol, startDate, endDate, interval } = req?.query;

    // buscar os dados de predicoes
    const dataPredict = await this.predictModel
      .find({
        symbol,
        ...(startDate && endDate ? {date: { $gte: new Date(startDate as any), $lte: new Date(endDate as any) }}:{}),
      })
      .sort({ date: 1 })
      .lean();

    let currentOperationIA: any = {};
    const output = [];
    const historic = [];
    for (const op of dataPredict.filter((e) => e?.operation) || []) {
      /* ANALISE DO LUCRO BASEADO NOS VALORES PREDICIONADOS */
      currentOperationIA = await this.eventsService.executeBackTest2({
        date: op.date,
        lote:
          Object.keys(currentOperationIA).length > 0
            ? currentOperationIA.lote
            : 100,
        typeOperation: op.operation,
        price:
          Object.keys(currentOperationIA).length > 0 &&
          currentOperationIA?.status === 'CLOSE'
            ? +(+op.open.toFixed(2))
            : +(+op.predictClose.toFixed(2)),
        currentOperation: currentOperationIA,
      });
      /* ------------------------------------------------------------------------------------- */

      // limpar a memoria de ordens
      if (currentOperationIA.status === 'CLOSE') {
        output.push({
          openOrderDate: currentOperationIA.date,
          closeOrderDate: op.date,
          open: currentOperationIA?.openPrice,
          close: op.close,
          closeIA: currentOperationIA?.closePrice,
          profitIA: currentOperationIA?.profit || 0,
          profitMarket: +(
            (currentOperationIA?.operationType === `BUY`
              ? op.close - op.open
              : op.open - op.close) * currentOperationIA.lote
          ).toFixed(2),
        });
        currentOperationIA = {};
      }
    }

    const calculated = output.reduce(
      (acc, item) => {
        acc.profitMarket += item.profitMarket;
        acc.profitIA += item.profitIA;
        return acc;
      },
      { profitMarket: 0, profitIA: 0 },
    );

    const bodyOutput = {
      historic,
      calculated,
      output,
      profits: {
        profitIA: output.flatMap((item) => [item.profitIA]),
        profitMarket: output.flatMap((item) => [item.profitMarket]),
      },
    };

    return res.json(bodyOutput);
  }

  @Post('syncMarket')
  async syncMarket(@Req() req: Request, @Res() res: Response) {
    const candles = await this.eventsService.getDataStock({
      symbol: req?.body?.symbol.toString(),
      period1: req?.body?.startDate.toString(),
      period2: req?.body?.endDate.toString(),
    });

    for (const candle of candles || []) {
      await this.candleModel.findOneAndUpdate(
        {
          symbol: req?.body?.symbol.toString(),
          timeframe: `D`,
          date: candle.date,
        },
        {
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        },
        {
          upsert: true,
          new: true,
        },
      );
    }
    return res.json(candles);
  }

  @Get('getTicker')
  async getTicker(@Req() req: Request, @Res() res: Response) {
    // buscar os codigos que foram feiros as predicoes
    const tickers = await this.predictModel.distinct('ticker').lean();
    return res.json(tickers);
  }
}
